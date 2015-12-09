The `gulp-github-changelog` package provides a few Gulp tasks for automatic changelog generation in markdown format.
Unlike other similar implementations, this one uses **GitHub milestones and issues** for its logic.
The `!preversion` and `!postversion` tasks should be used for the NPM's `preversion` and `postversion` script hooks.
The `!postversion` task publishes the changelog contents in the corresponding GitHub release.

## Overview

The generator exposes three gulp tasks - `changelog`, `!preversion`, and `!postversion`.
The `changelog` task is meant to be *run manually* before the release and updates the contents of the `CHANGELOG.md` file.
The `!preversion` and `!postversion` tasks should be attached as script hooks in `package.json`, so that the [`npm version`](https://docs.npmjs.com/cli/version) command will run them automatically.

### `changelog`
For the `changelog` task to work as expected, each version should have a matching GitHub milestone in the repository. The milestone name should equal the version name, including `"v"`.
For instance, the milestone for version `1.1.0` should be named `v1.1.0`. The generator fetches all closed milestone issues and lists them as changes for the respective version.

The issues are grouped in three categories - `New`, `Enhancements`, and `Fixed`. The grouping is based on the standard GitHub tags. Issues with no tag are put in the `New` category.

The task will fail if no milestone is found or if the milestone does not have any closed issues.
It also checks if the changelog already contains an entry for that version and aborts the task if so. An optional `--force` option may be passed to overwrite the existing entry.

The generated changelog is not automatically committed. This is intentional - the publisher should examine the contents, and, if necessary, add some manual edits in addition to the generated ones.

### `!preversion`

The `!preversion` task performs a few sanity checks and aborts the `npm version` if something is not right. It will fail when:

- No changelog entry for the new version is present in the `CHANGELOG.md`; The `changelog` task should be run first;
- Closed issues with no milestone are present. Issues tagged with `duplicate`, `invalid`, `wontfix` or `question` are ignored. The issues are most likely closed without the correct milestone; you should fix this before publishing;
- The milestone has any remaining open issues. They should be addressed or moved to the next planned release.

You may put the `!preversion` task as a prerequisite to another task which will run the unit tests.

### `!postversion`

The `!postversion` task pushes the version tag to GitHub and publishes the changelog piece to the respective release. It also closes the version milestone.

## Installation and usage

Install the package as local dev dependency.

```sh
    npm install --save-dev gulp-github-changelog
```

Make sure that your `package.json` has the correct repository settings (it will be used for the API calls)

```json
"repository": {
    "type": "git",
    "url": "https://github.com/user/repo.git"
}
```

Add the `preversion` and `postversion` script hooks to `package.json`:
```json
  "scripts": {
    "preversion": "gulp '!preversion'",
    "postversion": "gulp '!postversion'"
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
gulp changelog -v your_version [--force]
```

The `your_version` parameter accepts the same value as the [`npm version`](https://docs.npmjs.com/cli/version) command.

If the result does not quite fit the bill, fix the issue titles and categories and re-run the task with the `--force` parameter.

Afterwards, run `npm version`.
