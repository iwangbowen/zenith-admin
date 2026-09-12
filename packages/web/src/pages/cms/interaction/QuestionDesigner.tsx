import { useState } from 'react';
import { Button, Input, InputNumber, Modal, Select, Switch, Tag, TextArea, Tooltip, Typography } from '@douyinfe/semi-ui';
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, Plus, Trash2 } from 'lucide-react';
import { CMS_INTERACTION_NPS_MAX, CMS_INTERACTION_QUESTION_TYPE_OPTIONS, CMS_INTERACTION_RATING_MAX_LIMIT, CMS_INTERACTION_CONDITION_OP_OPTIONS } from '@zenith/shared/cms';
import type { CmsInteractionConditionOp, CmsInteractionKind, CmsInteractionQuestionType } from '@zenith/shared/cms';
import {
  applyQuestionType,
  createMatrixRow,
  createOption,
  createQuestion,
  duplicateLabels,
  duplicateQuestion,
  isChoiceType,
  moveItem,
  normalizePageNumbers,
  OTHER_CAPABLE_TYPES,
  parseOptionsText,
  remapConditions,
  stringifyOptions,
  CONDITION_SOURCE_TYPES,
  type QuestionDraft,
} from './question-draft';

interface QuestionDesignerProps {
  questions: QuestionDraft[];
  onChange: (next: QuestionDraft[]) => void;
  kind: CmsInteractionKind;
  /** 已收集答卷后题目结构锁定，全部只读 */
  locked: boolean;
  /** 题目 key → 错误文案 */
  errors: Map<string, string>;
}

/** 批量编辑：每行一个，确定后按文案回填（同名项复用原 id，避免答卷口径漂移） */
function BulkTextModal({ title, initial, hint, onCancel, onOk }: Readonly<{
  title: string;
  initial: string;
  hint: string;
  onCancel: () => void;
  onOk: (text: string) => void;
}>) {
  const [text, setText] = useState(initial);
  return (
    <Modal title={title} visible closeOnEsc onCancel={onCancel} onOk={() => onOk(text)} okText="覆盖" width={480}>
      <Typography.Text type="tertiary" size="small">{hint}</Typography.Text>
      <TextArea
        value={text}
        autosize={{ minRows: 8, maxRows: 16 }}
        style={{ marginTop: 8 }}
        placeholder={'第一项\n第二项\n第三项'}
        onChange={setText}
      />
    </Modal>
  );
}

/** 可增删排序的文本行编辑器，选项与矩阵行共用 */
function LabelRows({ items, disabled, mark, minCount, placeholder, onChange }: Readonly<{
  items: { id: string; label: string }[];
  disabled: boolean;
  mark: (index: number) => string;
  minCount: number;
  placeholder: string;
  onChange: (next: { id: string; label: string }[]) => void;
}>) {
  const duplicates = duplicateLabels(items);
  return (
    <div className="interaction-options">
      {items.map((item, index) => (
        <div key={item.id} className="interaction-options__row">
          <span className="interaction-options__mark">{mark(index)}</span>
          <Input
            value={item.label}
            disabled={disabled}
            placeholder={`${placeholder} ${index + 1}`}
            validateStatus={duplicates.has(item.label.trim()) ? 'error' : 'default'}
            onChange={(value) => onChange(items.map((row, i) => (i === index ? { ...row, label: value } : row)))}
          />
          <Button
            theme="borderless" size="small" icon={<ArrowUp size={13} />}
            disabled={disabled || index === 0} aria-label="上移"
            onClick={() => onChange(moveItem(items, index, -1))}
          />
          <Button
            theme="borderless" size="small" icon={<ArrowDown size={13} />}
            disabled={disabled || index === items.length - 1} aria-label="下移"
            onClick={() => onChange(moveItem(items, index, 1))}
          />
          <Button
            theme="borderless" type="danger" size="small" icon={<Trash2 size={13} />}
            disabled={disabled || items.length <= minCount} aria-label="删除"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          />
        </div>
      ))}
    </div>
  );
}

export default function QuestionDesigner({ questions, onChange, kind, locked, errors }: Readonly<QuestionDesignerProps>) {
  const [bulk, setBulk] = useState<{ index: number; target: 'options' | 'rows' } | null>(null);
  const isPoll = kind === 'poll';

  const patch = (index: number, updater: (question: QuestionDraft) => QuestionDraft) => {
    onChange(questions.map((question, i) => (i === index ? updater(question) : question)));
  };

  /** 题目顺序变化后重算条件引用，避免条件指向错题 */
  const reorder = (next: QuestionDraft[], moved: number[]) => {
    onChange(normalizePageNumbers(remapConditions(next, moved)));
  };

  const typeOptions = CMS_INTERACTION_QUESTION_TYPE_OPTIONS.filter((option) => !isPoll || option.value === 'single' || option.value === 'multiple');

  const pageCount = new Set(questions.map((question) => question.pageNo)).size;

  return (
    <div className="interaction-designer">
      {questions.map((question, index) => {
        const error = errors.get(question.key);
        const choice = isChoiceType(question.type);
        const conditionSources = questions
          .slice(0, index)
          .map((item, sourceIndex) => ({ item, sourceIndex }))
          .filter(({ item }) => CONDITION_SOURCE_TYPES.includes(item.type));
        const conditionSource = question.visibleWhen ? questions[question.visibleWhen.questionIndex] : undefined;
        return (
          <section
            key={question.key}
            className={error ? 'interaction-question interaction-question--error' : 'interaction-question'}
          >
            <header className="interaction-question__head">
              <span className="interaction-question__no">{index + 1}</span>
              <Input
                value={question.label}
                size="large"
                disabled={locked}
                placeholder="请输入题干，例如：您对我们的整体满意度？"
                onChange={(value) => patch(index, (item) => ({ ...item, label: value }))}
              />
              <Select
                value={question.type}
                disabled={locked}
                style={{ width: 104, flexShrink: 0 }}
                optionList={typeOptions}
                onChange={(value) => patch(index, (item) => applyQuestionType(item, value as CmsInteractionQuestionType))}
              />
              <Tooltip content={question.required ? '必答题' : '选答题'}>
                <span className="interaction-question__required">
                  <Switch
                    size="small"
                    checked={question.required}
                    disabled={locked}
                    onChange={(checked) => patch(index, (item) => ({ ...item, required: checked }))}
                  />
                  必答
                </span>
              </Tooltip>
              <div className="interaction-question__ops">
                <Tooltip content="上移">
                  <Button
                    theme="borderless" size="small" icon={<ArrowUp size={14} />}
                    disabled={locked || index === 0} aria-label="上移题目"
                    onClick={() => reorder(
                      moveItem(questions, index, -1),
                      moveItem(questions.map((_, i) => i), index, -1),
                    )}
                  />
                </Tooltip>
                <Tooltip content="下移">
                  <Button
                    theme="borderless" size="small" icon={<ArrowDown size={14} />}
                    disabled={locked || index === questions.length - 1} aria-label="下移题目"
                    onClick={() => reorder(
                      moveItem(questions, index, 1),
                      moveItem(questions.map((_, i) => i), index, 1),
                    )}
                  />
                </Tooltip>
                <Tooltip content="复制">
                  <Button
                    theme="borderless" size="small" icon={<Copy size={14} />}
                    disabled={locked || isPoll} aria-label="复制题目"
                    onClick={() => reorder(
                      [...questions.slice(0, index + 1), duplicateQuestion(question), ...questions.slice(index + 1)],
                      [...questions.map((_, i) => i).slice(0, index + 1), -1, ...questions.map((_, i) => i).slice(index + 1)],
                    )}
                  />
                </Tooltip>
                <Tooltip content="删除">
                  <Button
                    theme="borderless" type="danger" size="small" icon={<Trash2 size={14} />}
                    disabled={locked || isPoll || questions.length <= 1} aria-label="删除题目"
                    onClick={() => reorder(
                      questions.filter((_, i) => i !== index),
                      questions.map((_, i) => i).filter((i) => i !== index),
                    )}
                  />
                </Tooltip>
              </div>
            </header>

            {question.type === 'text' || question.type === 'date' || question.type === 'number' ? (
              <Typography.Text type="tertiary" size="small">
                {question.type === 'text' ? '文本题：前台展示为多行输入框' : null}
                {question.type === 'date' ? '日期题：前台展示为日期选择器，答案格式 YYYY-MM-DD' : null}
                {question.type === 'number' ? '数字题：前台展示为数字输入框，结果统计给出均值' : null}
              </Typography.Text>
            ) : null}

            {question.type === 'rating' || question.type === 'nps' ? (
              <div className="interaction-question__foot">
                {question.type === 'nps' ? (
                  <Typography.Text type="tertiary" size="small">
                    NPS 固定 0-{CMS_INTERACTION_NPS_MAX} 分，结果自动计算净推荐值
                  </Typography.Text>
                ) : (
                  <span className="interaction-question__limits">
                    满分
                    <InputNumber
                      size="small" min={2} max={CMS_INTERACTION_RATING_MAX_LIMIT} disabled={locked}
                      value={question.ratingMax} style={{ width: 68 }}
                      onChange={(value) => patch(index, (item) => ({ ...item, ratingMax: Number(value) || 5 }))}
                    />
                    分
                  </span>
                )}
              </div>
            ) : null}

            {question.type === 'matrix' ? (
              <>
                <Typography.Text type="tertiary" size="small">矩阵行（每行各选一个下方的选项）</Typography.Text>
                <LabelRows
                  items={question.matrixRows}
                  disabled={locked}
                  mark={(rowIndex) => String(rowIndex + 1)}
                  minCount={1}
                  placeholder="行"
                  onChange={(rows) => patch(index, (item) => ({ ...item, matrixRows: rows.map((row) => ({ id: row.id, label: row.label })) }))}
                />
                <div className="interaction-question__foot">
                  <Button
                    theme="borderless" size="small" icon={<Plus size={13} />} disabled={locked}
                    onClick={() => patch(index, (item) => ({ ...item, matrixRows: [...item.matrixRows, createMatrixRow('')] }))}
                  >
                    添加行
                  </Button>
                  <Button
                    theme="borderless" size="small" icon={<ClipboardPaste size={13} />} disabled={locked}
                    onClick={() => setBulk({ index, target: 'rows' })}
                  >
                    批量编辑行
                  </Button>
                </div>
                <Typography.Text type="tertiary" size="small">评价选项（矩阵的列）</Typography.Text>
              </>
            ) : null}

            {choice ? (
              <>
                <LabelRows
                  items={question.options}
                  disabled={locked}
                  mark={() => (question.type === 'multiple' ? '☐' : '○')}
                  minCount={2}
                  placeholder="选项"
                  onChange={(options) => patch(index, (item) => ({
                    ...item,
                    options: options.map((option) => {
                      const existing = item.options.find((current) => current.id === option.id);
                      return { id: option.id, label: option.label, value: existing?.value ?? option.id };
                    }),
                    maxChoices: Math.min(item.maxChoices, Math.max(options.length, 1)),
                  }))}
                />
                <div className="interaction-question__foot">
                  <Button
                    theme="borderless" size="small" icon={<Plus size={13} />} disabled={locked}
                    onClick={() => patch(index, (item) => ({ ...item, options: [...item.options, createOption('')] }))}
                  >
                    添加选项
                  </Button>
                  <Button
                    theme="borderless" size="small" icon={<ClipboardPaste size={13} />} disabled={locked}
                    onClick={() => setBulk({ index, target: 'options' })}
                  >
                    批量编辑
                  </Button>
                  {OTHER_CAPABLE_TYPES.includes(question.type) ? (
                    <span className="interaction-question__required">
                      <Switch
                        size="small" checked={question.allowOther} disabled={locked}
                        onChange={(checked) => patch(index, (item) => ({ ...item, allowOther: checked }))}
                      />
                      「其他」填空
                      {question.allowOther ? (
                        <Input
                          size="small" style={{ width: 110 }} disabled={locked}
                          value={question.otherLabel} placeholder="其他"
                          onChange={(value) => patch(index, (item) => ({ ...item, otherLabel: value }))}
                        />
                      ) : null}
                    </span>
                  ) : null}
                  {question.type === 'multiple' ? (
                    <span className="interaction-question__limits">
                      最少选
                      <InputNumber
                        size="small" min={0} max={question.options.length} disabled={locked}
                        value={question.minChoices} style={{ width: 68 }}
                        onChange={(value) => patch(index, (item) => ({ ...item, minChoices: Number(value) || 0 }))}
                      />
                      最多选
                      <InputNumber
                        size="small" min={1} max={question.options.length} disabled={locked}
                        value={question.maxChoices} style={{ width: 68 }}
                        onChange={(value) => patch(index, (item) => ({ ...item, maxChoices: Number(value) || 1 }))}
                      />
                      项
                    </span>
                  ) : null}
                </div>
              </>
            ) : null}

            {!isPoll ? (
              <div className="interaction-question__foot interaction-question__advanced">
                <span className="interaction-question__limits">
                  第
                  <InputNumber
                    size="small" min={1} max={50} disabled={locked}
                    value={question.pageNo} style={{ width: 64 }}
                    onChange={(value) => onChange(normalizePageNumbers(questions.map((item, i) => (
                      i === index ? { ...item, pageNo: Math.max(1, Number(value) || 1) } : item
                    ))))}
                  />
                  页
                </span>
                <Select
                  size="small"
                  placeholder="始终显示"
                  showClear
                  disabled={locked || conditionSources.length === 0}
                  style={{ width: 190 }}
                  value={question.visibleWhen?.questionIndex}
                  optionList={conditionSources.map(({ item, sourceIndex }) => ({
                    value: sourceIndex,
                    label: `第 ${sourceIndex + 1} 题：${item.label || '未命名'}`,
                  }))}
                  onChange={(value) => patch(index, (item) => ({
                    ...item,
                    visibleWhen: value === undefined || value === null
                      ? null
                      : { questionIndex: Number(value), op: item.visibleWhen?.op ?? 'any', values: [] },
                  }))}
                />
                {question.visibleWhen && conditionSource ? (
                  <>
                    <Select
                      size="small" style={{ width: 190 }} disabled={locked}
                      value={question.visibleWhen.op}
                      optionList={CMS_INTERACTION_CONDITION_OP_OPTIONS}
                      onChange={(value) => patch(index, (item) => ({
                        ...item,
                        visibleWhen: item.visibleWhen ? { ...item.visibleWhen, op: value as CmsInteractionConditionOp } : null,
                      }))}
                    />
                    <Select
                      size="small" multiple placeholder="选择触发选项" style={{ minWidth: 200 }} disabled={locked}
                      value={question.visibleWhen.values}
                      optionList={conditionSource.options.map((option) => ({ value: option.value, label: option.label || option.value }))}
                      onChange={(value) => patch(index, (item) => ({
                        ...item,
                        visibleWhen: item.visibleWhen ? { ...item.visibleWhen, values: (value as string[]) ?? [] } : null,
                      }))}
                    />
                  </>
                ) : null}
                {pageCount > 1 ? <Tag size="small" color="blue">共 {pageCount} 页</Tag> : null}
              </div>
            ) : null}

            {error ? <Typography.Text type="danger" size="small">{error}</Typography.Text> : null}
          </section>
        );
      })}

      {!locked && !isPoll ? (
        <Button
          className="interaction-designer__add"
          icon={<Plus size={14} />}
          onClick={() => onChange([...questions, createQuestion('single')])}
        >
          添加题目
        </Button>
      ) : null}

      {bulk ? (
        <BulkTextModal
          key={`${bulk.index}-${bulk.target}`}
          title={bulk.target === 'rows' ? '批量编辑矩阵行' : '批量编辑选项'}
          hint={bulk.target === 'rows'
            ? '每行一个矩阵行，空行自动忽略。已有同名行会保留原标识。'
            : '每行一个选项，空行自动忽略。已有同名选项会保留原标识。'}
          initial={stringifyOptions(bulk.target === 'rows' ? questions[bulk.index].matrixRows : questions[bulk.index].options)}
          onCancel={() => setBulk(null)}
          onOk={(text) => {
            const current = questions[bulk.index];
            if (bulk.target === 'rows') {
              const parsed = parseOptionsText(text, current.matrixRows.map((row) => ({ id: row.id, label: row.label, value: row.id })));
              patch(bulk.index, (item) => ({
                ...item,
                matrixRows: parsed.length > 0 ? parsed.map((row) => ({ id: row.id, label: row.label })) : item.matrixRows,
              }));
            } else {
              const parsed = parseOptionsText(text, current.options);
              patch(bulk.index, (item) => ({
                ...item,
                options: parsed.length > 0 ? parsed : item.options,
                maxChoices: Math.min(item.maxChoices, Math.max(parsed.length, 1)),
              }));
            }
            setBulk(null);
          }}
        />
      ) : null}
    </div>
  );
}
