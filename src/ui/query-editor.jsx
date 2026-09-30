// A rule's conditions edited with react-querybuilder; esbuild bundles this file into query-editor.bundle.js.

import { createRoot } from 'react-dom/client';
import { QueryBuilder, update } from 'react-querybuilder';
import { OPERATORS, FIELDS, FIELD_OPERATORS, WORD_OPS, FOLDER_OPS, newCondition } from '../lib/organize.js';
import { pickFolder } from './components.js';

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
    <label className="row">
      Rule:
      <select aria-label={level ? 'Group rule' : 'Rule'} value={current} onChange={change}>
        {Object.keys(RULE_SETTINGS).map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </label>
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
    <select aria-label="Field" value={rule.field} onChange={change}>
      {options.map((o) => <option key={o.name} value={o.name}>{o.label}</option>)}
    </select>
  );
}

// A folder condition's folder, chosen with the page's folder picker.
function FolderEditor({ value, handleOnChange, context }) {
  const pick = async () => {
    const picked = await pickFolder(context.root, value ?? '', { heading: 'Choose a folder', verb: 'Folder', allowCreate: false });
    if (picked) handleOnChange(picked);
  };
  return (
    <button type="button" className={`folder-button${value ? '' : ' unset'}`} aria-label="Folder" onClick={pick}>
      <span className="folder-icon" aria-hidden="true" />
      {value ? value.split('/').join(' › ') : 'Choose folder…'}
    </button>
  );
}

// One keyword, with the case and whole-word switches beside it.
function KeywordEditor(props) {
  const { operator, value, handleOnChange, rule, path, schema } = props;
  if (FOLDER_OPS.has(operator)) return <FolderEditor {...props} />;
  const setFlag = (prop) => (e) => schema.dispatchQuery(update(schema.getQuery(), prop, e.target.checked, path));
  return (
    <>
      <input type="text" className={`keyword${operator === 'matchesRegex' ? ' mono' : ''}`} aria-label="Keyword" value={value ?? ''}
        placeholder={PLACEHOLDERS[operator] ?? 'Keyword'} onChange={(e) => handleOnChange(e.target.value)} />
      {operator !== 'onDomain' && (
        <label className="check-line small" title="Match upper and lower case exactly">
          <input type="checkbox" checked={!!rule.caseSensitive} onChange={setFlag('caseSensitive')} />Aa
        </label>
      )}
      {WORD_OPS.has(operator) && (
        <label className="check-line small" title="Only match whole words, so “cat” does not match “category”">
          <input type="checkbox" aria-label="Whole words" checked={!!rule.wholeWords} onChange={setFlag('wholeWords')} />Whole words
        </label>
      )}
    </>
  );
}

const translations = {
  addRule: { label: '+ Condition', title: 'Add a condition' },
  addGroup: { label: '+ Group', title: 'Add a group with its own rule setting' },
  removeRule: { label: '×', title: 'Remove condition' },
  removeGroup: { label: 'Remove group', title: 'Remove group' },
};

const classNames = {
  queryBuilder: 'query-editor',
  ruleGroup: 'cond-group',
  header: 'row wrap',
  body: 'conditions',
  rule: 'condition',
  addRule: 'small',
  addGroup: 'small',
  removeRule: 'small',
  removeGroup: 'small group-remove',
};

function Editor({ query, onChange, context }) {
  return (
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
      controlElements={{ combinatorSelector: RuleSelector, fieldSelector: FieldSelector, valueEditor: KeywordEditor }}
      context={context}
      controlClassnames={classNames}
      translations={translations}
    />
  );
}

// Shows the editor for `query` in `element` and reports each change; `root` is the bookmark tree the folder picker shows.
// Call the result to take it down again.
export function mountQueryEditor(element, query, onChange, { root: tree }) {
  const root = createRoot(element);
  root.render(<Editor query={query} onChange={onChange} context={{ root: tree }} />);
  return () => root.unmount();
}
