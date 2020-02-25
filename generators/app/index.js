'use strict';
var Generator = require('yeoman-generator');
var fs = require('fs');
var path = require('path');
var read = require('fs-readdir-recursive');
var reactDocs = require('react-docgen');
var debug = require('debug');
const prettier = require('prettier');
const pascalcase = require('pascalcase');

const log = debug('generator-tsx-docgen:log');
const error = debug('generator-tsx-docgen:error');

const renderSnippet = (snippet, tabtrigger, description) => {
  // escape " with \"
  // split lines by line-break
  const separatedSnippet = snippet
    .trim()
    // .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .split('\n');
  const separatedSnippetLength = separatedSnippet.length;
  const lastLine = separatedSnippetLength - 1;

  // add double quotes around each line apart from the last one
  const newSnippet = separatedSnippet.map((line, index) => {
    return index === lastLine ? `\t\t\t\t"${line}"` : index === 0 ? `"${line}",` : `\t\t\t\t"${line}",`;
  });
  // prettier-ignore
  return `
    {
      "prefix": "${tabtrigger}",
      "body": [
        ${newSnippet.join('\n')}
      ],
      "description": "${description}"
    }
  `;
};

const _extends =
  Object.assign ||
  function(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
    return target;
  };

const filenameFromPath = filePath => {
  // console.log();
  // log('filenameFromPath ', filePath);
  const filePathNoExtension = filePath.split('.tsx');
  const filePathNoExtensionArray = filePathNoExtension[0].split('/');
  const filename = filePathNoExtensionArray[filePathNoExtensionArray.length - 1];
  return filename;
};

const getFirstLiteralFromElements = (elements, required) => {
  let firstLiteral;
  if (elements) {
    for (let i = 0; i < elements.length; i++) {
      if (elements[i].name === 'literal') {
        firstLiteral = elements[i].value;
        break;
      } else if (elements[i].name === 'ReactElementType') {
        firstLiteral = '() => <p>ReactElementType</p>';
        break;
      } else if (elements[i].name === 'number') {
        firstLiteral = '1';
        break;
      } else if (elements[i].name === 'boolean') {
        firstLiteral = 'true';
        break;
      } else if (elements[i].name === 'string') {
        firstLiteral = "'string'";
        break;
      } else if (elements[i].name === 'Function') {
        firstLiteral = '() => {}';
        break;
      } else if (elements[i].name === 'Array') {
        if (elements[i].raw && elements[i].raw.indexOf('number') > -1) {
          firstLiteral = '[1]';
          break;
        } else if (elements[i].raw && elements[i].raw.indexOf('string') > -1) {
          firstLiteral = "['string']";
          break;
        } else {
          firstLiteral = elements[i].raw ? `[undefined as ${elements[i].raw.split('[]')[0]}]` : '[]';
          break;
        }
      } else if (elements[i].name === 'tuple') {
        firstLiteral = elements[i].raw ? elements[i].raw.replace(/number/g, '42').replace(/string/g, "'string'") : '[]';
        break;
      }
    }
  }
  if (!firstLiteral) {
    firstLiteral = required ? "'string'" : 'undefined';
  }
  return firstLiteral;
};

const generateFakeProp = ({ propName, name, value, raw, elements, signature, required }) => {
  // log('generateFakeProp ', {propName, name, value, raw, elements});
  const isShape = typeof value === 'object';
  if (isShape) {
    const fakeShape = {};
    Object.keys(value).forEach(shapeChildName => {
      const fakeProp = generateFakeProp({ propName, name: shapeChildName, value: value[shapeChildName].name });
      const fakePropName = fakeProp.name;
      const fakePropValue = fakeProp.value;
      fakeShape[fakePropName] = fakePropValue;
    });
    return { propName, name, value: fakeShape };
  }
  switch (name) {
    case 'any':
      return { name, value: "'any'" };
    case 'signature':
      let signatureValue = '() => {}';
      if (raw) {
        const rawPieces = raw.split('=>');
        if (rawPieces.length === 2) {
          signatureValue = `${rawPieces[0].trim()} => undefined as ${rawPieces[1].trim()}`;
        } else {
          signatureValue = raw;
        }
      }
      return { name, value: signatureValue };
    case 'literal':
      return { name, value: '() => {}' };
    case 'func':
      return { name, value };
    case 'number':
      return { name, value: '42' };
    case 'string':
      return { name, value: 'string' };
    case 'boolean':
      return { name, value: 'true' };
    case 'array':
    case 'Array':
      return { name, value: '[]' };
    case 'union':
      const firstLiteral = getFirstLiteralFromElements(elements, required);
      return { name, value: `${firstLiteral}` };
    case 'ReactReactText':
    case 'ReactText':
      return { name, value: '42' };
    case 'ReactReactElement':
    case 'ReactElement':
      return { name, value: '<p>ReactElement</p>' };
    case 'ReactReactNode':
    case 'ReactNode':
      return { name, value: '<div>ReactNode</div>' };
    case 'ReactRefObject':
    case 'RefObject':
      return { name, value: `{ current: document.createElement('div') }` };
    case 'ReactReactRef':
    case 'ReactRef':
      return { name, value: '() => {}' };
    case 'ReactReactElementType':
    case 'ReactElementType':
      return { name, value: '() => <div />' };
    case 'HTMLElement':
      return { name, value: 'document.body' };
    default:
      return { name, value: required ? `{}/*unrecognizedType ${name} ${value}*/` : 'undefined' };
  }
  // return {name, value};
};

const extractDefaultProps = (filePath, currentFilePath) => {
  // log('extractDefaultProps ', {filePath, currentFilePath});
  const filename = filenameFromPath(filePath);
  const fileString = fs.readFileSync(filePath, 'utf8');
  try {
    // log(JSON.stringify(fileString));
    var componentInfo = reactDocs.parse(fileString, null, null, { filename: filePath });
  } catch (err) {
    error(filePath, 'is not a React Component, ');
    throw new Error(err);
  }
  const componentProps = [];
  const componentHasProps = componentInfo.props ? componentInfo.props : false;
  if (!componentHasProps) {
    error('No props found in ', filename, ' at ', filePath);
    return { filePath, componentProps, filename, currentFilePath };
  }

  // log(JSON.stringify(componentInfo.props));
  const propNames = Object.keys(componentInfo.props);
  for (let i = 0; i < propNames.length; i += 1) {
    const propName = propNames[i];
    if (propName.indexOf('ouia') > -1) {
      // TODO, allow list of ignored props
      continue;
    }
    let propType;
    if (componentInfo.props[propName].tsType) {
      // union | boolean | ReactReactNode | string
      propType = componentInfo.props[propName].tsType.name;
    } else {
      // error('propType not set for ' + propName + ' in ' + filename + ' at ' + currentFilePath + ' consider setting it in propTypes');
      propType = "'string'";
    }
    let propDefaultValue;
    const hasDefaultvalue = componentInfo.props[propName].defaultValue
      ? componentInfo.props[propName].defaultValue
      : false;
    const { tsType, required, description } = componentInfo.props[propName];
    const { name, value, raw, elements, signature } = tsType;
    let fakeProp;
    if (hasDefaultvalue) {
      if (componentInfo.props[propName].defaultValue.computed) {
        fakeProp = generateFakeProp({ propName, name, value, raw, elements, signature, required });
        propDefaultValue = fakeProp.value;
      } else {
        try {
          const evaluatedDefaultValue = eval(componentInfo.props[propName].defaultValue.value);
          // log(`typeof ${componentInfo.props[propName].defaultValue.value}: ${typeof evaluatedDefaultValue}`);
          switch (typeof evaluatedDefaultValue) {
            case 'undefined':
              propDefaultValue = required ? `{}/*unrecognizedType ${name} ${value}*/` : 'undefined';
              break;
            default:
              propDefaultValue = componentInfo.props[propName].defaultValue.value;
          }
        } catch (e) {
          if (componentInfo.props[propName].defaultValue.value.indexOf('=>') > -1) {
            propDefaultValue = componentInfo.props[propName].defaultValue.value;
          } else {
            fakeProp = generateFakeProp({ propName, name, value, raw, elements, signature, required });
            propDefaultValue = fakeProp.value;
          }
        }
      }
      if (
        propName === 'children' &&
        componentInfo.props[propName].tsType.name.indexOf('ReactNode') > -1 &&
        componentInfo.props[propName].defaultValue.value === 'null'
      ) {
        // don't default to null
        propDefaultValue = '<>ReactNode</>';
      }
      // log({propName, propType, propDefaultValue});
    } else {
      // log('defaultProps value not set for ' + propName + ' in ' + filename + ' at ' + currentFilePath + ' consider setting it  in defaultProps');
      fakeProp = generateFakeProp({ propName, name, value, raw, elements, signature, required });
      propDefaultValue = fakeProp.value;
      // log('Generated ', fakeProp, 'returning it as ', {propName, propType, propDefaultValue, currentFilePath});
    }
    componentProps.push({ propName, propType, propDefaultValue, currentFilePath, required, description });
  }
  return { filePath, componentProps, componentInfo, filename, currentFilePath };
};

module.exports = class extends Generator {
  constructor(args, opts) {
    super(args, opts);
    this.option('template', {
      desc: 'Custom template to use for tests',
      alias: 't',
      type: String,
      default: '',
      hide: false
    });
    this.option('path', {
      desc: 'Folder that contains .tsx files',
      alias: 'p',
      type: String,
      default: '',
      hide: false
    });
    this.option('make-tests', {
      desc: 'Generates jest tests',
      alias: 'j',
      type: Boolean,
      default: true,
      hide: false
    });
    this.option('make-snippets', {
      desc: 'Generate snippets file',
      alias: 's',
      type: Boolean,
      default: false,
      hide: false
    });
    this.option('make-fragments', {
      desc: 'Generates fragments',
      alias: 'f',
      type: Boolean,
      default: false,
      hide: true
    });
    this.option('append-version', {
      desc: 'Append a version to the created file',
      alias: 'v',
      type: String,
      default: '',
      hide: true
    });
    this.makeCodeFragments = (metadata, flatStructure, chosenPath, withComments, version) => {
      let jsonSnippet = {
        codeCategories: []
      };
      const getCategoryJson = category => {
        return {
          category,
          codeFragments: []
        };
      };
      const getFragmentJson = (label, content) => {
        return {
          label,
          content
        };
      };
      const componentsCategory = getCategoryJson('Components');
      const layoutsCategory = getCategoryJson('Layouts');
      const betaCategory = getCategoryJson('Beta');
      const getCategory = filePath => {
        // console.log(`filePath: ${filePath}`);
        let groupArr;
        let group;
        let fragment;
        let category;
        let matcher;
        if (filePath.indexOf('/experimental/') > -1) {
          matcher = /\/src\/experimental\/.*\/(.*?)\//;
          category = betaCategory;
        } else if (filePath.indexOf('/beta/') > -1) {
          matcher = /\/src\/beta\/(.*?)\//;
          category = betaCategory;
        } else if (filePath.indexOf('/components/') > -1) {
          matcher = /\/src\/components\/(.*?)\//;
          category = componentsCategory;
        } else if (filePath.indexOf('/layouts/') > -1) {
          matcher = /\/src\/layouts\/(.*?)\//;
          category = layoutsCategory;
        } else {
          matcher = /\/src\/components\/(.*?)\//;
          category = componentsCategory;
        }
        // console.log(`category: ${JSON.stringify(category)}`)
        groupArr = filePath.match(matcher);
        group = (groupArr && groupArr[1]) || 'Unknown';
        fragment = category.codeFragments.find(fragment => fragment.group === group);
        if (!fragment) {
          fragment = {
            group,
            children: []
          };
          category.codeFragments.push(fragment);
        }
        // console.log(`fragment: ${JSON.stringify(fragment)}`)
        // console.log(`returning ${category.codeFragments[category.codeFragments.length - 1].group}`)
        return fragment.children;
      };
      for (let i = 0; i < metadata.length; i += 1) {
        const compMetaData = metadata[i];
        const pascalFilename = pascalcase(compMetaData.filename);
        const currentCategoryGroup = getCategory(compMetaData.filePath);
        const getDefaultValue = componentMeta =>
          componentMeta.propType === 'shape' || componentMeta.propType === 'string'
            ? JSON.stringify(componentMeta.propDefaultValue, null, 1)
            : componentMeta.propDefaultValue;
        let hasChildren;
        let placeholderIndex = 1;
        const body = compMetaData.componentProps
          .filter(componentMeta => {
            if (componentMeta.propName === 'children') {
              if (withComments) {
                hasChildren = `\t{\${0:${getDefaultValue(componentMeta)}}/* ${
                  componentMeta.required ? 'required: ' : 'optional: '
                }${componentMeta.description.replace(/(\n)+/g, ' | ')} */}`;
                return false;
              } else {
                hasChildren = `\t{\${0:${getDefaultValue(componentMeta)}}}`;
                return false;
              }
            }
            return true;
          })
          .map(componentMeta => {
            if (withComments) {
              return `\t${componentMeta.propName}={\${${placeholderIndex++}:${getDefaultValue(componentMeta)}}/* ${
                componentMeta.required ? 'required: ' : 'optional: '
              }${componentMeta.description.replace(/(\n)+/g, ' | ')} */}`;
            } else {
              return `\t${componentMeta.propName}={\${${placeholderIndex++}:${getDefaultValue(componentMeta)}}}`;
            }
          });

        let snippetBody;
        if (hasChildren) {
          snippetBody = `<${pascalFilename}\n${body.join('\n')}\n>\n${hasChildren}\n</${pascalFilename}>`;
        } else {
          snippetBody = `<${pascalFilename}\n${body.join('\n')}\n/>`;
        }
        currentCategoryGroup.push(getFragmentJson(pascalFilename, snippetBody));
      }
      jsonSnippet.codeCategories.push(componentsCategory, layoutsCategory, betaCategory);
      if (flatStructure) {
        fs.writeFileSync(
          path.join(
            chosenPath,
            withComments
              ? `codeFragmentsWithComments${version ? `_${version}` : ''}.json`
              : `codeFragmentsNoComments${version ? `_${version}` : ''}.json`
          ),
          JSON.stringify({
            codeFragments: componentsCategory.codeFragments
              .concat(layoutsCategory.codeFragments)
              .concat(betaCategory.codeFragments)
          }),
          'utf-8'
        );
      } else {
        fs.writeFileSync(
          path.join(
            chosenPath,
            withComments
              ? `codeFragmentsWithComments${version ? `_${version}` : ''}.json`
              : `codeFragmentsNoComments${version ? `_${version}` : ''}.json`
          ),
          JSON.stringify(jsonSnippet),
          'utf-8'
        );
      }
    };
    this.makeSnippets = (metadata, chosenPath, withComments, version) => {
      let snippetsString = '{\n';
      for (let i = 0; i < metadata.length; i += 1) {
        const compMetaData = metadata[i];
        const pascalFilename = pascalcase(compMetaData.filename);
        const getDefaultValue = componentMeta =>
          componentMeta.propType === 'shape' || componentMeta.propType === 'string'
            ? JSON.stringify(componentMeta.propDefaultValue, null, 1)
            : componentMeta.propDefaultValue;
        let hasChildren;
        let placeholderIndex = 1;
        const body = compMetaData.componentProps
          .filter(componentMeta => {
            if (componentMeta.propName === 'children') {
              if (withComments) {
                hasChildren = `\\t{\${0:${getDefaultValue(componentMeta)}}/* ${
                  componentMeta.required ? 'required: ' : 'optional: '
                }${componentMeta.description.replace(/(\n)+/g, ' | ')} */}`;
              } else {
                hasChildren = `\\t{\${0:${getDefaultValue(componentMeta)}}}`;
              }
              return false;
            }
            return true;
          })
          .map(componentMeta => {
            if (withComments) {
              return `\\t${componentMeta.propName}={\${${placeholderIndex++}:${getDefaultValue(componentMeta)}}/* ${
                componentMeta.required ? 'required: ' : 'optional: '
              }${componentMeta.description.replace(/(\n)+/g, ' | ')} */}`;
            } else {
              return `\\t${componentMeta.propName}={\${${placeholderIndex++}:${getDefaultValue(componentMeta)}}}`;
            }
          });

        let snippetBody;
        if (hasChildren) {
          snippetBody = `<${pascalFilename}
${body.join('\n')}
>
${hasChildren}
</${pascalFilename}>`;
        } else {
          snippetBody = `<${pascalFilename}
${body.join('\n')}
/>`;
        }
        const snippet = renderSnippet(snippetBody, `${withComments ? '#' : '!'}${pascalFilename}`, `${pascalFilename}`);
        snippetsString = `${snippetsString}\n\t"${pascalFilename}": ${snippet},`;
      }
      snippetsString = `${snippetsString}\n}`;

      fs.writeFileSync(
        path.join(
          chosenPath,
          withComments
            ? `snippetsWithComments${version ? `_${version}` : ''}.json`
            : `snippetsNoComments${version ? `_${version}` : ''}.json`
        ),
        snippetsString,
        'utf-8'
      );
    };
  }
  prompting() {
    if (this.options.template.length) {
      this.log(`Received custom template of: ${this.options.template}`);
    }
    // this.log(yosay('Let\'s create tests'));
    const prompts = [
      {
        type: 'input',
        name: 'COMPONENTS_PATH',
        message: 'Folder that contains .tsx files',
        store: true,
        
      }/*,
      {
        type: 'confirm',
        name: 'MAKE_TESTS',
        message: 'Generate tests?',
        default: 'n'
      },
      {
        type: 'confirm',
        name: 'MAKE_SNIPPETS',
        message: 'Generate snippets?',
        default: 'n'
      },
      {
        type: 'confirm',
        name: 'MAKE_FRAGMENTS',
        message: 'Generate fragments?',
        default: 'n'
      },
      {
        type: 'input',
        name: 'APPEND_VERSION',
        message: 'Append a version number?',
        store: true
      }*/
    ];
    if (this.options.path) {
      if (this.options.path.slice(-1) !== '/') {
        this.options.path = `${this.options.path}/`;
      }
    } else {
      return this.prompt(prompts).then(
        function(props) {
          if (props.COMPONENTS_PATH.slice(-1) !== '/') {
            props.COMPONENTS_PATH = `${props.COMPONENTS_PATH}/`;
          }
          this.props = props;
        }.bind(this)
      );
    }
  }
  writing() {
    const chosenPath = this.options.path || (this.props && this.props.COMPONENTS_PATH);
    const version = this.options['append-version'] || (this.props && this.props.APPEND_VERSION);
    const makeTests = this.options['make-tests'] || (this.props && this.props.MAKE_TESTS);
    const makeSnippets = this.options['make-snippets'] || (this.props && this.props.MAKE_SNIPPETS);
    const makeCodeFragments = this.options['make-fragments'] || (this.props && this.props.MAKE_FRAGMENTS);
    const flatStructure = false;
    const filePaths = read(chosenPath).filter(filename => filename.endsWith('.tsx') && filename.indexOf('.test.') < 0);
    if (filePaths.length === 0) {
      const noJsMessage = 'Did not find any .tsx files';
      console.log(noJsMessage);
      error(noJsMessage);
    }
    const metadata = [];
    for (let i = 0; i < filePaths.length; i += 1) {
      const currentFilePath = filePaths[i];
      const completeFilePath = chosenPath + currentFilePath;
      // console.log(completeFilePath);
      try {
        const componentInfo = extractDefaultProps(completeFilePath, currentFilePath);
        metadata.push(componentInfo);
      } catch (err) {
        error('Couldnt extractDefaultProps from ' + currentFilePath + ' at ' + completeFilePath);
        error(err);
      }
    }
    if (makeCodeFragments) {
      this.makeCodeFragments(metadata, flatStructure, chosenPath, true, version);
      this.makeCodeFragments(metadata, flatStructure, chosenPath, false, version);
    }
    if (makeSnippets) {
      this.makeSnippets(metadata, chosenPath, true, version);
      this.makeSnippets(metadata, chosenPath, false, version);
    }
    if (makeTests) {
      for (let i = 0; i < metadata.length; i += 1) {
        const compMetaData = metadata[i];
        const testPath = path.resolve(
          compMetaData.filePath,
          path.join('..', '__tests__/Generated', compMetaData.filename + '.test.tsx')
        );
        const templatePath = this.options.template.length
          ? path.join(this.sourceRoot('.'), this.options.template)
          : 'index.template.js';
        this.fs.copyTpl(
          this.templatePath(templatePath),
          this.destinationPath(testPath),
          _extends({}, compMetaData, {
            relativeFilePath: path.join('../..', compMetaData.filename),
            pascalFilename: pascalcase(compMetaData.filename)
          })
        );
        try {
          const generatedTestCode = this.fs.read(testPath);
          const formattedTestCode = prettier.format(generatedTestCode, {
            semi: true,
            singleQuote: true,
            tabWidth: 2,
            trailingComma: 'none',
            useTabs: false,
            printWidth: 120,
            parser: 'typescript'
          });
          this.fs.write(testPath, formattedTestCode);
        } catch (err) {
          error('Couldnt lint generated code :( from ' + compMetaData);
          error(err);
        }
      }
    }
  }
};
