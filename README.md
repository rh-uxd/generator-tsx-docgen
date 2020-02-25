# TSX docgen yeoman generator

## What's that ?

This is a [Yeoman](http://yeoman.io) generator that parses `.tsx` component files using `react-docgen` and interprets the props and defaults. Once parsed, it can create either jest snapshot test files (the default choice), or snippet files that can be used in VSCode.

Test files are added to a component's directory into a `__tests__/Generated` folder.


## Installation

```bash
npm install yo generator-tsx-docgen
```


## Commands

Default, generate jest test files:
`yo tsx-jest`

Provide the path to the folder that contains `.tsx` files. It can be a relative path, such as `./` or `./src`.

Give the path to your folder or ```cd``` to it and put ```./``` as path


Other options:
`yo tsx-jest --help`

```
Usage:
  yo tsx-docgen:app [options]

Options:
  -h,   --help           # Print the generator's options and usage
        --skip-cache     # Do not remember prompt answers             Default: false
        --skip-install   # Do not automatically install dependencies  Default: false
        --force-install  # Fail on install dependencies error         Default: false
  -t,   --template       # Custom template to use for tests
  -p,   --path           # Folder that contains .tsx files
  -j,   --make-tests     # Generates jest tests                       Default: true
  -s,   --make-snippets  # Generate snippets                          Default: false
```

## Conflicts

If a file conflict is detected, you are given the following options:
```
Overwrite src/components/Alert/__tests__/Generated/Alert.test.tsx? (ynaxdH) 
  y) overwrite
  n) do not overwrite
  a) overwrite this and all others
  x) abort
  d) show the differences between the old and the new
  h) Help, list all options
```
