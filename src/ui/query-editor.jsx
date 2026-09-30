// A rule's conditions edited with react-querybuilder; esbuild bundles this file into query-editor.bundle.js.

import { createRoot } from 'react-dom/client';
import { QueryBuilder, update, remove } from 'react-querybuilder';
import { QueryBuilderDnD } from '@react-querybuilder/dnd';
import * as ReactDnD from 'react-dnd';
import * as ReactDndHtml5Backend from 'react-dnd-html5-backend';
import { OPERATORS, FIELDS, FIELD_OPERATORS, WORD_OPS, FOLDER_OPS, newCondition } from '../lib/organize.js';
import { pickFolder } from './components.js';
import 'react-querybuilder/dist/query-builder.css';

const fields = Object.entries(FIELDS).map(([name, label]) => ({
  name,
  label,
  operators: FIELD_OPERATORS[name].map((op) => ({ name: op, label: OPERATORS[op] })),
}));

const PLACEHOLDERS = { matchesRegex: 'Pattern', onDomain: 'example.com', hasParam: 'v or list=PL123' };

// "none" and "not all" are react-querybuilder's `not` flag on an "any" or "all" group.
const RULE_SETTINGS = {
  any: { combinator: 'or', not: false },
  all: { combinator: 'and', not: false },
  none: { combinator: 'or', not: true },
  'not all': { combinator: 'and', not: true },
};

function RuleSelector({ ruleGroup, path, schema, level }) {
  const current = Object.keys(RULE_SETTINGS).find((k) => RULE_SETTINGS[k].combinator === ruleGroup.combinator && RULE_SETTINGS[k].not === !!ruleGroup.not) ?? 'any';
  const change = (e) => schema.dispatchQuery(update(schema.getQuery(), RULE_SETTINGS[e.target.value], path));
  return (
    <select className="ruleGroup-combinators" aria-label={level ? 'Group rule' : 'Rule'} value={current} onChange={change}>
      {Object.keys(RULE_SETTINGS).map((k) => <option key={k} value={k}>{k}</option>)}
    </select>
  );
}

// Changing the field keeps the operator and keyword where they still make sense: the operator falls back to the
// field's first one when the field does not offer it, and a keyword is cleared on switching to or from a folder.
function FieldSelector({ rule, path, schema, options }) {
  const change = (e) => {
    const field = e.target.value;
    const patch = { field };
    if (!FIELD_OPERATORS[field].includes(rule.operator)) patch.operator = FIELD_OPERATORS[field][0];
    if ((field === 'folder') !== (rule.field === 'folder')) patch.value = '';
    schema.dispatchQuery(update(schema.getQuery(), patch, path));
  };
  return (
    <select className="rule-fields" aria-label="Field" value={rule.field} onChange={change}>
      {options.map((o) => <option key={o.name} value={o.name}>{o.label}</option>)}
    </select>
  );
}

// The × that removes a condition, placed right after its keyword or folder so the two read as one.
function RemoveButton({ path, schema }) {
  return (
    <button type="button" className="small keyword-remove" title="Remove condition" aria-label="Remove condition"
      onClick={() => schema.dispatchQuery(remove(schema.getQuery(), path))}>×</button>
  );
}

// A folder condition's folder, chosen with the page's folder picker.
function FolderEditor({ operator, rule, value, handleOnChange, context, path, schema }) {
  const pick = async () => {
    const picked = await pickFolder(context.root, value ?? '', { heading: 'Choose a folder', verb: 'Folder', allowCreate: false });
    if (picked) handleOnChange(picked);
  };
  return (
    <span className="rule-value">
      <span className="keyword-with-remove">
        <button type="button" className={`folder-button${value ? '' : ' unset'}`} aria-label="Folder" onClick={pick}>
          <span className="folder-icon" aria-hidden="true" />
          {value ? value.split('/').join(' › ') : 'Choose folder…'}
        </button>
        <RemoveButton path={path} schema={schema} />
      </span>
      <Switches operator={operator} rule={rule} setFlag={() => undefined} />
    </span>
  );
}

// The case and whole-word switches; one that does not apply keeps its place, so every row's columns line up.
function Switches({ operator, rule, setFlag }) {
  const caseApplies = operator !== 'onDomain' && !FOLDER_OPS.has(operator);
  const wordsApply = WORD_OPS.has(operator);
  return (
    <>
      <label className={`check-line small rule-case${caseApplies ? '' : ' unused'}`} title="Match upper and lower case exactly">
        <input type="checkbox" aria-label="Match case" disabled={!caseApplies} checked={!!rule.caseSensitive} onChange={setFlag('caseSensitive')} />Aa
      </label>
      <label className={`check-line small rule-words${wordsApply ? '' : ' unused'}`} title="Only match whole words, so “cat” does not match “category”">
        <input type="checkbox" aria-label="Whole words" disabled={!wordsApply} checked={!!rule.wholeWords} onChange={setFlag('wholeWords')} />Whole words
      </label>
    </>
  );
}

// One keyword, with the case and whole-word switches beside it.
function KeywordEditor(props) {
  const { operator, value, handleOnChange, rule, path, schema } = props;
  if (FOLDER_OPS.has(operator)) return <FolderEditor {...props} />;
  const setFlag = (prop) => (e) => schema.dispatchQuery(update(schema.getQuery(), prop, e.target.checked, path));
  return (
    <span className="rule-value">
      <span className="keyword-with-remove">
        <input type="text" className={`keyword${operator === 'matchesRegex' ? ' mono' : ''}`} aria-label="Keyword" value={value ?? ''}
          placeholder={PLACEHOLDERS[operator] ?? 'Keyword'} onChange={(e) => handleOnChange(e.target.value)} />
        <RemoveButton path={path} schema={schema} />
      </span>
      <Switches operator={operator} rule={rule} setFlag={setFlag} />
    </span>
  );
}

const translations = {
  addRule: { label: '+ Condition', title: 'Add a condition' },
  addGroup: { label: '+ Group', title: 'Add a group with its own rule setting' },
  removeRule: { label: '×', title: 'Remove condition' },
  removeGroup: { label: 'Remove group', title: 'Remove group' },
  cloneRule: { label: 'Copy', title: 'Add a copy of this condition' },
  cloneRuleGroup: { label: 'Copy group', title: 'Add a copy of this group' },
  dragHandle: { label: '⠿', title: 'Drag to move, into another group too' },
};

// react-querybuilder's own layout, with branch lines joining each condition to its group.
const classNames = {
  queryBuilder: 'query-editor queryBuilder-branches',
  addRule: 'small',
  addGroup: 'small',
  removeRule: 'small',
  removeGroup: 'small',
  cloneRule: 'small',
  cloneGroup: 'small',
};

// Drag and drop between groups, through react-querybuilder's own add-on.
const dnd = { ...ReactDnD, ...ReactDndHtml5Backend };

function Editor({ query, onChange, context }) {
  return (
    <QueryBuilderDnD dnd={dnd}>
    <QueryBuilder
      fields={fields}
      defaultQuery={query}
      onQueryChange={onChange}
      enableMountQueryChange={false}
      resetOnFieldChange={false}
      addRuleToNewGroups
      getDefaultField="either"
      getDefaultOperator="contains"
      getDefaultValue={() => ''}
      onAddRule={(rule) => ({ ...newCondition(rule.field, rule.operator), id: rule.id })}
      controlElements={{ combinatorSelector: RuleSelector, fieldSelector: FieldSelector, valueEditor: KeywordEditor, removeRuleAction: () => null }}
      context={context}
      controlClassnames={classNames}
      translations={translations}
      showCloneButtons
    />
    </QueryBuilderDnD>
  );
}

// Shows the editor for `query` in `element` and reports each change; `root` is the bookmark tree the folder picker shows.
// Call the result to take it down again.
export function mountQueryEditor(element, query, onChange, { root: tree }) {
  const root = createRoot(element);
  root.render(<Editor query={query} onChange={onChange} context={{ root: tree }} />);
  return () => root.unmount();
}
