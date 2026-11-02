export async function liveChecks({ projectId, version, baseUrl, files, staticChecks }) {
  const checks = [...staticChecks];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });

  try {
    const response = await fetch(`${baseUrl}/preview/${projectId}/${version}/`, { redirect: 'follow' });
    const html = await response.text();
    const ok = response.status === 200 && /text\/html/i.test(response.headers.get('content-type') || '');
    add('preview', '预览可访问', ok ? 'pass' : 'fail', `HTTP ${response.status} · ${(html.length / 1024).toFixed(1)} KB`);
    const injected = html.includes('__ATOMS_APP__') && html.includes('/atoms-runtime.js');
    add('runtime', '预览运行时注入', injected ? 'pass' : 'fail', injected ? 'atomsStore 运行时已注入' : '未发现运行时注入');
  } catch (error) {
    add('preview', '预览可访问', 'fail', String(error.message || error).slice(0, 120));
    add('runtime', '预览运行时注入', 'fail', '预览不可达');
  }

  try {
    const key = `__probe_${Date.now()}`;
    const payload = { ok: true, at: new Date().toISOString() };
    const put = await fetch(`${baseUrl}/api/apps/${projectId}/store/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: payload }),
    });
    const read = await fetch(`${baseUrl}/api/apps/${projectId}/store/${key}`);
    const readJson = await read.json();
    await fetch(`${baseUrl}/api/apps/${projectId}/store/${key}`, { method: 'DELETE' });
    const ok = put.ok && read.ok && readJson?.value?.ok === true;
    add('store', '服务端数据持久化', ok ? 'pass' : 'fail', ok ? '写入 → 读取 → 删除 全部成功' : 'atomsStore 读写失败');
  } catch (error) {
    add('store', '服务端数据持久化', 'fail', String(error.message || error).slice(0, 120));
  }

  const interactive = checks.find((check) => check.id === 'interaction');
  if (interactive && interactive.status !== 'fail') {
    add('interaction-live', '交互元素可用', 'pass', interactive.detail);
  }

  const failed = checks.filter((check) => check.status === 'fail').length;
  const warned = checks.filter((check) => check.status === 'warn').length;
  add('summary', '验收结论', failed ? 'fail' : warned ? 'warn' : 'pass', failed ? `${failed} 项失败，${warned} 项警告` : warned ? `${checks.length - failed - warned} 项通过，${warned} 项提示` : '全部检查通过');
  return checks;
}

export function buildReport({ project, version, checks }) {
  const total = checks.length;
  const failed = checks.filter((check) => check.status === 'fail').length;
  const warned = checks.filter((check) => check.status === 'warn').length;
  const passed = total - failed - warned;
  const score = Math.round((passed / total) * 100);
  const icon = { pass: '通过', warn: '提示', fail: '失败' };
  const markdown = [
    `# ${project.name} · v${version.number} 验收报告`,
    '',
    `- 生成时间：${new Date().toLocaleString('zh-CN')}`,
    `- 模型：${version.model || 'unknown'}`,
    `- 检查项：${total} ｜ 通过 ${passed} ｜ 提示 ${warned} ｜ 失败 ${failed}`,
    `- 综合评分：${score} / 100`,
    '',
    '| 检查项 | 状态 | 说明 |',
    '| --- | --- | --- |',
    ...checks.map((check) => `| ${check.label} | ${icon[check.status] || check.status} | ${String(check.detail).replaceAll('|', '/')} |`),
  ].join('\n');
  return {
    version: version.number,
    generatedAt: new Date().toISOString(),
    summary: { total, passed, warned, failed, score },
    checks,
    markdown,
    model: version.model,
    projectId: project.id,
  };
}
