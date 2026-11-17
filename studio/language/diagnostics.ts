import type { Analysis } from './semantic';
import type { Profile } from './profile';

/** Keep the actionable message short; parser details remain available on demand. */
export function diagnostics(a: Analysis, p: Profile) {
  return a.issues.map((issue) => {
    let message = issue.message,
      start = issue.start,
      end = issue.end,
      replacement = issue.replacement;
    const name = message.match(/'([^']+)'/)?.[1];
    const labels: Record<string, string> = {
      undeclared: `尚未声明${name ? ' ' + name : '此名称'}`,
      'builtin-declaration': `先声明内置 CO${name ? ' ' + name : ''}`,
      'unknown-type': `找不到概念${name ? ' ' + name : ''}`,
      'unknown-operator': `找不到算子${name ? ' ' + name : ''}`,
      'declaration-order': `将${name ? ' ' + name + ' 的' : ''}声明移到使用之前`,
      duplicate: `${name || '当前名称'} 已有声明或签名冲突`,
      domain: '绑定范围需要概念或集合',
      'missing-value': '原文没有给出此值，需人工确认',
      'inheritance-cycle': '概念的父级关系形成循环',
      'invalid-expression': '此处需要值或算子调用'
    };
    if (labels[issue.code]) message = labels[issue.code];
    if (issue.code === 'type-mismatch') {
      const types = message.match(/^Expected (.*), received (.*)\.$/);
      message = types ? `需要 ${types[1]}，当前为 ${types[2]}` : '类型不匹配';
    }
    if (issue.code === 'arity') message = '参数个数与算子签名不符';
    if (issue.code === 'syntax') {
      const token = a.program.tokens.find((t) => t.start >= issue.start);
      const previous = a.program.tokens
        .filter((t) => t.end <= issue.start && t.kind !== 'comment')
        .at(-1);
      if (
        token &&
        p.surface.SetClose.includes(token.text) &&
        previous &&
        p.surface.ConditionSeparator.includes(previous.text)
      ) {
        message = `最后一项后无需 ${previous.text}`;
        start = previous.start;
        end = previous.end;
        replacement = '';
      } else {
        const expected = issue.message.match(/Expecting token of type --> (.*?) <--/i)?.[1];
        message =
          expected === 'ID'
            ? '此处需要名称'
            : expected && expected.length < 18
              ? `此处需要 ${expected}`
              : '此处语法未完成，请检查括号、名称或分隔符';
      }
    }
    return {
      ...issue,
      start,
      end,
      replacement,
      message,
      detail: message === issue.message ? undefined : issue.message,
      severity: ['missing-value', 'naming-style'].includes(issue.code) ? 'warning' : 'error'
    };
  });
}
