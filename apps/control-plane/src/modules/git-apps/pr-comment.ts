import { Logger } from '@nestjs/common';

const log = new Logger('PrComment');

export interface PrCommentTarget {
  provider: 'github' | 'gitlab';
  /** owner/repo */
  repo: string;
  prNumber: number;
  /** Existing comment id to update (GitHub issue comment id / GitLab note id). */
  commentId?: string | null;
  body: string;
  accessToken: string;
  /** Optional GitLab host (default gitlab.com). */
  gitlabHost?: string;
}

/**
 * Post or update a PR/MR comment with the preview URL. Soft-fails on any
 * permission / network error — callers should never abort the deploy for this.
 */
export async function upsertPrComment(
  target: PrCommentTarget,
): Promise<string | null> {
  try {
    if (target.provider === 'github') {
      return await upsertGithub(target);
    }
    return await upsertGitlab(target);
  } catch (e) {
    log.warn(
      `PR comment soft-fail (${target.provider} ${target.repo}#${target.prNumber}): ${(e as Error).message}`,
    );
    return null;
  }
}

async function upsertGithub(t: PrCommentTarget): Promise<string | null> {
  const [owner, ...rest] = t.repo.split('/');
  const repo = rest.join('/');
  if (!owner || !repo) return null;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${t.accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'self-hosted-preview-envs',
    'Content-Type': 'application/json',
  };

  if (t.commentId) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/comments/${t.commentId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ body: t.body }),
      },
    );
    if (res.ok) return t.commentId;
    // Fall through to create if the comment was deleted.
    if (res.status !== 404) {
      throw new Error(`GitHub PATCH comment ${res.status}`);
    }
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${t.prNumber}/comments`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: t.body }),
    },
  );
  if (!res.ok) throw new Error(`GitHub POST comment ${res.status}`);
  const json = (await res.json()) as { id?: number };
  return json.id != null ? String(json.id) : null;
}

async function upsertGitlab(t: PrCommentTarget): Promise<string | null> {
  const host = (t.gitlabHost || process.env.GITLAB_HOST || 'gitlab.com')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const project = encodeURIComponent(t.repo);
  const headers: Record<string, string> = {
    'PRIVATE-TOKEN': t.accessToken,
    'Content-Type': 'application/json',
    'User-Agent': 'self-hosted-preview-envs',
  };

  if (t.commentId) {
    const res = await fetch(
      `https://${host}/api/v4/projects/${project}/merge_requests/${t.prNumber}/notes/${t.commentId}`,
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({ body: t.body }),
      },
    );
    if (res.ok) return t.commentId;
    if (res.status !== 404) {
      throw new Error(`GitLab PUT note ${res.status}`);
    }
  }

  const res = await fetch(
    `https://${host}/api/v4/projects/${project}/merge_requests/${t.prNumber}/notes`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: t.body }),
    },
  );
  if (!res.ok) throw new Error(`GitLab POST note ${res.status}`);
  const json = (await res.json()) as { id?: number };
  return json.id != null ? String(json.id) : null;
}

export function previewCommentBody(opts: {
  previewUrl: string | null;
  branch: string;
  panelUrl?: string | null;
}): string {
  const lines = [
    '### Preview environment',
    '',
    opts.previewUrl
      ? `🚀 Preview: ${opts.previewUrl}`
      : `Preview is deploying from \`${opts.branch}\` (no public host configured).`,
  ];
  if (opts.panelUrl) {
    lines.push('', `Panel: ${opts.panelUrl}`);
  }
  lines.push(
    '',
    '_This comment is managed by Self-Hosted preview environments._',
  );
  return lines.join('\n');
}
