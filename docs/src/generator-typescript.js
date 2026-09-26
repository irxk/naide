import { Generator } from './generator.js';

export class TypeScriptGenerator extends Generator {
  constructor(options = {}) {
    super(options);
  }

  mapType(naideType) {
    const MAP = { str: 'string', int: 'number', num: 'number', bool: 'boolean', list: 'any[]', map: 'Record<string, any>', json: 'any', any: 'any', void: 'void' };
    return MAP[naideType] || 'any';
  }

  visitTypedVar(node) {
    const keyword = node.isMut ? 'let' : 'const';
    const exp = node.isPublic ? 'export ' : '';
    const tsType = this.mapType(node.varType);
    const value = this.expr(node.value);
    this.emit(`${exp}${keyword} ${node.name}: ${tsType} = ${value};`);
  }

  visitFunction(node) {
    const exp = node.isPublic ? 'export ' : '';
    const async = node.isAsync ? 'async ' : '';
    const params = node.params.map(p => {
      let s = p.spread ? '...' : '';
      s += p.name;
      if (p.type) s += `: ${this.mapType(p.type)}`;
      else s += ': any';
      if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
      return s;
    }).join(', ');
    const retType = node.returnType ? `: ${this.mapType(node.returnType)}` : '';
    this.emit(`${exp}${async}function ${node.name}(${params})${retType} {`);
    this.indent++;
    for (const stmt of node.body) this.visitStatement(stmt);
    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }

  visitSchema(node) {
    // Emit TypeScript interface first
    const name = node.name;
    this.emit(`interface ${name} {`);
    this.indent++;
    for (const f of node.fields) {
      const tsType = this.mapType(f.type);
      const opt = f.modifiers.some(m => m.name === 'optional') ? '?' : '';
      this.emit(`${f.name}${opt}: ${tsType};`);
    }
    this.indent--;
    this.emit('}');
    this.emitRaw('');
    // Then call parent for the runtime store
    super.visitSchema(node);
  }

  visitModel(node) {
    this.models.set(node.name, node);

    const exp = node.isPublic ? 'export ' : '';
    const ext = node.parent ? ` extends ${node.parent}` : '';
    this.emit(`${exp}class ${node.name}${ext} {`);
    this.indent++;

    // Typed field declarations
    for (const f of node.fields) {
      const tsType = this.mapType(f.type);
      if (f.defaultValue) {
        this.emit(`${f.name}: ${tsType} = ${this.expr(f.defaultValue)};`);
      } else {
        this.emit(`${f.name}: ${tsType};`);
      }
    }

    if (node.fields.length > 0 || node.parent) {
      const parentModel = node.parent ? this.models.get(node.parent) : null;
      const parentFields = parentModel ? parentModel.fields : [];
      const allFields = [...parentFields, ...node.fields];

      const constructorParams = allFields.map(f => {
        let s = `${f.name}: ${this.mapType(f.type)}`;
        if (f.defaultValue) s += ` = ${this.expr(f.defaultValue)}`;
        return s;
      }).join(', ');

      this.emit(`constructor(${constructorParams}) {`);
      this.indent++;
      if (node.parent) {
        const superArgs = parentFields.map(f => f.name).join(', ');
        this.emit(`super(${superArgs});`);
      }
      for (const f of node.fields) {
        this.emit(`this.${f.name} = ${f.name};`);
      }
      this.indent--;
      this.emit('}');
      this.emitRaw('');
    }

    for (const method of node.methods) {
      const async = method.isAsync ? 'async ' : '';
      const params = method.params.map(p => {
        let s = p.spread ? '...' : '';
        s += p.name;
        if (p.type) s += `: ${this.mapType(p.type)}`;
        else s += ': any';
        if (p.defaultValue) s += ` = ${this.expr(p.defaultValue)}`;
        return s;
      }).join(', ');

      this.emit(`${async}${method.name}(${params}) {`);
      this.indent++;
      for (const stmt of method.body) {
        this.visitStatement(stmt);
      }
      this.indent--;
      this.emit('}');
      this.emitRaw('');
    }

    this.indent--;
    this.emit('}');
    this.emitRaw('');
  }
}
