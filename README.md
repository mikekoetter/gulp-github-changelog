# GitHub Changelog Gulp Tasks

As the name suggests, The package provides a few Gulp tasks for automatic changelog generation in markdown format.
Unlike other similar implementations, this one uses **GitHub milestones and issues** for its logic.
The `!preversion` and `!postversion` gulp tasks suitable for NPM's `preversion` and `postversion` script hooks.
The `!postversion` task publishes the changelog contents in the corresponding GitHub release.

## Overview

The generator exposes three gulp tasks - `changelog`, `!preversion`, and `!postversion`.
The `changelog` task is meant to be run manually before the release and updates the contents of the `CHANGELOG.md` file.
The `!preversion` and `!postversion` tasks should be attached as script hooks in `package.json` and will be run automatically by the [`npm version`](https://docs.npmjs.com/cli/version) command.

### package.json

```json
  "scripts": {
    "preversion": "gulp '!preversion'",
    "postversion": "gulp '!postversion'"
  },
```

For the `changelog` task to work as expected, each version should have a matching *GitHub milestone* in the repository. The milestone name should equal the version name, including `"v"`.
For instance, the milestone for version `1.1.0` should be named `v1.1.0`. The generator pulls all closed milestone issues and lists them as changes for the version.

The issues are grouped in three categories - `New`, `Enhancements`, `Fixed`. The grouping is based on the standard GitHub tags. Issues with no tag are put in the `New` category.

Upon generation, the changelog generator will trigger an error if no milestone is found or if the milestone does not have any closed issues.
It also checks if the changelog does already contain an entry for that version and aborts the task if so. An optional `--force` option may be passed to overwrite the existing entry.

Notice that the generated changelog is not automatically committed. This is intentional - the publisher should examine the contents, and, if necessary, do some manual work in addition to the automatic entries.

The `!preversion` task performs a few sanity checks and aborts the `npm version` if something is not quite right. It will fail when:

- no changelog entry for the new version is present in the `CHANGELOG.md`; The `changelog` task should be run first;
- **closed issues** with no milestone are present in the repository. Issues tagged with `duplicate`, `invalid`, `wontfix` or `question` are ignored. The issues are most likely closed without the correct milestone; you should fix this before publishing.
- It will fail if the milestone has any remaining open issues. They should be addressed or moved to the next planned release.

You may put the `!preversion` task as a prerequisite to another task which will run the unit tests, for example.

The `!postversion` task pushes the version tag to GitHub and publishes the changelog piece to the respective release. It also closes the published version milestone.

## Installation and usage

Install the package as local dev dependency.

```sh
    npm install --save-dev gulp-github-changelog
```

Make sure that your `package.json` has the correct repository settings (it will be used for the API calls):

```json
"repository": {
    "type": "git",
    "url": "https://github.com/user/repo.git"
}
```

[Generate a GitHub token](https://help.github.com/articles/creating-an-access-token-for-command-line-use/) for your account, and make it available as an environment variable:

```sh
echo 'source $HOME/.github_token' >> .bashrc # or .zshrc if you use zshell
echo 'export GITHUB_TOKEN="your token here"' >> $HOME/.github_token
```

Add the following line to your `gulpfile.js`

```javascript
const gulp = require('gulp')
require('gulp-github-changelog')(gulp)
```

Before your release, run the `changelog` task:

```
gulp changelog -v your_version
```

The `your_version` parameter accepts the same value as the [`npm version`](https://docs.npmjs.com/cli/version) command.

Afterwards, run `npm version`.
