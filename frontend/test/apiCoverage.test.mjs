import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const source = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
const tree = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true)
const canonical = value => value.split('?')[0].replace(/\{[^}]*\}/g, '{}')
const clients = []
function visit(node) {
  if (ts.isCallExpression(node) && ['request', 'listAll'].includes(node.expression.getText(tree))) {
    const arg = node.arguments[0]
    let path
    if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) path = arg.text
    else if (arg && ts.isTemplateExpression(arg)) path = arg.head.text + arg.templateSpans.map(span => (ts.isConditionalExpression(span.expression) && ts.isStringLiteral(span.expression.whenFalse) ? span.expression.whenFalse.text : '{}') + span.literal.text).join('')
    if (path) {
      let parent = node.parent
      while (parent && !ts.isPropertyAssignment(parent)) parent = parent.parent
      if (parent) {
        const method = parent.name.getText(tree)
        const declaration = parent.parent?.parent
        const owner = declaration && ts.isVariableDeclaration(declaration) ? declaration.name.getText(tree) : ''
        const options = node.arguments[1]
        const verb = options && ts.isObjectLiteralExpression(options) ? options.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(tree) === 'method')?.initializer.text : undefined
        clients.push({ operation: (verb ?? 'GET') + ' ' + canonical(path), call: owner + '.' + method })
      }
    }
  }
  ts.forEachChild(node, visit)
}
visit(tree)
const python = `import ast,json
from pathlib import Path
result=[]
for p in Path('backend/app').glob('*.py'):
 t=ast.parse(p.read_text(encoding='utf-8')); prefixes={}
 for n in t.body:
  if isinstance(n,ast.Assign) and isinstance(n.value,ast.Call) and getattr(n.value.func,'id','')=='APIRouter':
   prefixes[n.targets[0].id]=next((ast.literal_eval(k.value) for k in n.value.keywords if k.arg=='prefix'),'')
 for n in t.body:
  if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)):
   for d in n.decorator_list:
    if isinstance(d,ast.Call) and isinstance(d.func,ast.Attribute) and d.func.attr in ['get','post','put','patch','delete']:
     prefix=prefixes.get(getattr(d.func.value,'id',''),''); path=(prefix+ast.literal_eval(d.args[0])).removeprefix('/api/v1')
     result.append(d.func.attr.upper()+' '+path)
print(json.dumps(result))`

test('every backend HTTP operation has an API client used by a frontend screen', () => {
  const routes = JSON.parse(execFileSync('python', ['-c', python], { cwd: root, encoding: 'utf8' }))
  const screens = readdirSync(new URL('../src/', import.meta.url)).filter(name => /\.tsx?$/.test(name) && name !== 'api.ts').map(name => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8')).join('\n')
  const uncovered = routes.filter(route => !clients.some(client => client.operation === canonical(route) && (client.call.startsWith('observationsApi.') ? screens.includes(client.call) : ['api', 'records', 'data'].some(owner => new RegExp('\\b' + owner + '\\.' + client.call.split('.')[1] + '\\b').test(screens)))))
  assert.deepEqual(uncovered, [], 'Unconnected backend operations: ' + uncovered.join(', '))
  assert.ok(routes.length > 0, 'Backend route inventory must not be empty')
})
