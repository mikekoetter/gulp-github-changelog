'use strict'

const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')

const gulp = require('gulp')
const insert = require('gulp-insert')
const util = require('gulp-util')

const Promise = require('bluebird')
const Handlebars = require('handlebars')
const semver = require('semver')
const argv = require('yargs').argv
const Github = require('github')
const linkParser = require('parse-link-header')

const PER_PAGE = 1000
const CHANGELOG_FILENAME = 'CHANGELOG.md'

const getAllPages = getPage =>
    getPage(1).then( page => {
        const results = [page]
        const linkHeader = linkParser(page.meta.link)

        if (!linkHeader) {
            return results
        }

        for (let i = 2; i <= linkHeader.last.page; i++) {
            results.push(getPage(i))
        }

        return Promise.all(results)
    }).then( pages =>
        pages.reduce( (a, b) => a.concat(b) )
    )

const isBug = issue =>
    issue.labels.find( label => label.name === 'bug')

const isEnhancement = issue =>
    issue.labels.find( label => label.name === 'enhancement')

const groupIssues = issues => {
    const groups = {"New": [], "Enhancements": [], "Fixed": []}

    issues.forEach(issue => {
        if (isBug(issue)) {
            groups.Fixed.push(issue)
        } else if (isEnhancement(issue)) {
            groups.Enhancements.push(issue)
        } else {
            groups.New.push(issue)
        }
    })

    return groups
}

const git = cmd =>
    childProcess.execSync(`git ${cmd}`)

const printIssues = (issues, message) =>
    issues.forEach( issue =>
        util.log(util.colors.red(`#${issue.number} - ${issue.html_url} ${message}`))
    )

const changelogMarkdown = milestoneData => {
    const data = {
        date: new Date().toDateString(),
        milestone: milestoneData.milestone,
        issues: milestoneData.issues
    }

    return Handlebars.compile(`
## {{milestone.title}} ({{date}})
{{#each issues}}
{{#if this.length}}

### {{@key}}
{{#this}}
- [#{{number}}]({{html_url}}) {{title}}
{{/this}}
{{/if}}
{{/each}}
    `)(data)
}

const addToChangelog = contents =>
    new Promise(resolve =>
        gulp.src(CHANGELOG_FILENAME)
            .pipe(insert.prepend(contents))
            .pipe(gulp.dest('./'))
            .on('end', resolve)
    )

const removeChangelogEntry = version => {
    const removed = fs.readFileSync(CHANGELOG_FILENAME).toString().replace(new RegExp(`## v${version} (\n|.)+?\n## `, 'm'), '## ')
    fs.writeFileSync(CHANGELOG_FILENAME, removed)
}

const changelogEntryExists = version =>
    fs.readFileSync(CHANGELOG_FILENAME).toString().match(new RegExp(`^## v${version}`, 'm'))

const changelogNotesFor = version => {
    let regexp = new RegExp(`(## v${version} \.+\n((\n|.)+?))\n## `, 'm')

    if (version === '0.1.0') { // initial version, bottom of changelog
        regexp = new RegExp(`(## v0.1.0 \.+\n((\n|.)+))`, 'm')
    }

    return fs.readFileSync(CHANGELOG_FILENAME).toString().match(regexp)[2]
}


const reject = message =>
    new Promise((resolve, reject) => reject(message))

const parentPackage = () =>
    require(path.join(path.dirname(module.parent.filename), 'package.json'))

const repoInfo = () => {
    const userAndRepo = parentPackage().repository.url.match(/([\w_-]+)\/([\w-_]+)(\.git)?$/)
    const token = process.env['GITHUB_TOKEN']

    if (!token) {
        throw new Error('Missing GITHUB_TOKEN env variable. Check the README for more details')
    }

    return new GithubRepo(userAndRepo[1], userAndRepo[2], token)
}

class GithubRepo {
    constructor(user, repo, token) {
        this.user = user
        this.repo = repo
        this.token = token
        const github = new Github({version: "3.0.0"})

        github.authenticate({token: token, type: 'oauth'})

        this.issues = Promise.promisifyAll(github.issues)
        this.releases = Promise.promisifyAll(github.releases)
        this.gitData = Promise.promisifyAll(github.gitdata)
        this.repos = Promise.promisifyAll(github.repos)
    }

    getMilestone(version) {
        return getAllPages( page =>
            this.issues.getAllMilestonesAsync({repo: this.repo, user: this.user, PER_PAGE, page} )
        ).then( milestones => {
            const milestone = milestones.find(milestone => milestone.title === `v${version}`)

            return milestone ? milestone : reject('No milestone found')
        })
    }

    getRelease(version) {
        return getAllPages( page =>
            this.releases.listReleasesAsync({repo: this.repo, owner: this.user, PER_PAGE, page} )
        ).then( releases =>
           releases.find(release => release.title === `v${version}`)
        )
    }

    closeMilestone(version) {
        return this.getMilestone(version)
            .then( milestone =>
                this.issues.updateMilestoneAsync({
                    repo: this.repo,
                    user: this.user,
                    number: milestone.number,
                    title: milestone.title,
                    state: 'closed'
                })
            ).catch(() => {
                util.log(util.color.yellow(`Could not find open milestone v${version}, most likely closed`))
            })
    }

    getClosedIssuesWithNoMilestone() {
        return getAllPages( page =>
            this.issues.repoIssuesAsync({
                state: 'closed',
                milestone: 'none',
                repo: this.repo,
                user: this.user,
                PER_PAGE,
                page
            })
        ).then( issues =>
            issues.filter( issue => !issue.labels.find( label => label.name.match(/duplicate|invalid|wontfix|question/) ) )
        )
    }

    getMilestoneIssues(milestone, state) {
        return getAllPages( page =>
            this.issues.repoIssuesAsync({
                state: state,
                milestone: milestone,
                repo: this.repo,
                user: this.user,
                PER_PAGE,
                page
            })
        )
    }

    getMilestoneAndIssues(version) {
        return this.getMilestone(version)
            .then( milestone => {
                if (!milestone) {
                    return reject(`No milestone for ${version} found`)
                }

                return Promise.join(milestone, this.getMilestoneIssues(milestone.number, 'closed'))
            }).then( args =>
                ({milestone: args[0], issues: groupIssues(args[1])})
            )
    }

    getOpenMilestoneIssues(version) {
        return this.getMilestone(version)
            .then( milestone =>
                this.getMilestoneIssues(milestone.number, 'open')
            )
    }

    postReleaseNotes(version, notes) {
        return this.releases.createReleaseAsync({
            owner: this.user,
            repo: this.repo,
            'tag_name': `v${version}`,
            name: `v${version}`,
            body: notes
        })
    }
}

module.exports = function(gulp) {

    gulp.task('changelog', () => {
        let version = argv['v']

        if (!version) {
            return reject('No version specified, pass -v (major|minor|patch), etc. or a number. https://docs.npmjs.com/cli/version for more details.')
        }

        if (!version.match(/^\d/)) {
            version = semver.inc(parentPackage().version, version)
        }

        util.log(util.colors.blue(`Changelog vor ${version} requested`))

        if (changelogEntryExists(version)) {
            if (!argv['force']) {
                return reject(`Changelog entry for v${version} exists, pass --force to override`)
            }

            util.log(util.colors.yellow(`Removing existing entry for ${version}`))
            removeChangelogEntry(version)
        }

        return repoInfo().getMilestoneAndIssues(version)
            .then(data => {

                if (data.milestone.closed_issues === 0) {
                    return reject(`No closed issues found for v${version}`)
                }

                const markdown = changelogMarkdown(data)

                util.log(util.colors.green(markdown))

                return addToChangelog(markdown)
                //  .then(() => {
                //      git('add CHANGELOG.md')
                //      git(`commit --message 'v${version} changelog'`)
                //  })
            })
    })

    gulp.task('!preversion', () => {
        const version = process.env['npm_package_version']
        const info = repoInfo()

        if (!changelogEntryExists(version)) {
            return reject(`No changelog entry for v${version} exists`)
        }

        return Promise.join(
            info.getClosedIssuesWithNoMilestone(),
            info.getOpenMilestoneIssues(version)
        )
        .then( data => {
            const orphanIssues = data[0]
            const openIssues = data[1]
            let exit = 0

            if (orphanIssues.length) {
                printIssues(orphanIssues, 'is closed with no milestone')
                exit = 1
            }

            if (openIssues.length) {
                printIssues(openIssues, 'is still open')
                exit = 1
            }

            if (exit) {
                return reject('Check issue report above')
            }
        })
    })

    gulp.task('!postversion', () => {
        const version = process.env['npm_package_version']
        const info = repoInfo()

        git('push')
        git('push --tags')

        return Promise.join(
            info.closeMilestone(version),
            info.postReleaseNotes(version, changelogNotesFor(version))
        )
    })
}
