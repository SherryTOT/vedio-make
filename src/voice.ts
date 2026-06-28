/**
 * `pipeline voice <sub>` — manage MiniMax cloned voices (§6 of the port spec).
 *
 *   pipeline voice clone <audio> --label "我的声音"   upload + clone → minimax:user_<hex>
 *   pipeline voice list                               list clones (+ 168h status)
 *   pipeline voice keepalive minimax:user_xxx         refresh the 168h trial window
 *   pipeline voice rm minimax:user_xxx                delete LOCAL record (MiniMax has no delete API)
 *
 * Cloned voices are usable anywhere a voice id is accepted, as `minimax:<voice_id>`.
 */
import path from "node:path";
import {
  cloneVoice, listVoices, removeVoice, keepaliveVoice, voiceStatus, CloneError,
} from "./providers/minimax/voice-clone.ts";

/** Accept either bare `user_xxx` or namespaced `minimax:user_xxx`. */
function bareId(id: string): string {
  return id.startsWith("minimax:") ? id.slice("minimax:".length) : id;
}

function fmtStatus(v: ReturnType<typeof listVoices>[number]): string {
  const st = voiceStatus(v);
  if (st.state === "permanent") return "永久";
  if (st.state === "expired") return "已过期(MiniMax 侧可能已删,可重新克隆)";
  const h = Math.floor((st.remainingSec ?? 0) / 3600);
  return `试用 · 约剩 ${h}h(用一次即转永久)`;
}

export async function runVoice(sub: string, positional: string[], flags: Record<string, string | boolean>): Promise<void> {
  if (sub === "clone") {
    const audio = positional[0];
    if (!audio) { console.error(`voice clone: 需要音频文件路径(mp3/m4a/wav,10s–5min)`); process.exit(1); }
    const label = (flags.label as string) || path.basename(audio);
    try {
      console.log(`[voice] 上传 + 克隆 '${audio}' …(upload ≤180s / clone ≤240s)`);
      const v = await cloneVoice(path.resolve(process.cwd(), audio), label);
      console.log(`✓ 克隆成功: minimax:${v.voice_id}`);
      console.log(`  名称: ${v.label}`);
      console.log(`  状态: 试用,168h 内用一次即转永久(任何一次 tts/say 调用都算)`);
      console.log(`  用法: pipeline say "测试" --voice minimax:${v.voice_id}`);
    } catch (e) {
      const ce = e as CloneError;
      console.error(`✗ 克隆失败: ${ce.message}`);
      if (ce.details) console.error(`  详情: ${ce.details}`);
      process.exit(1);
    }
    return;
  }

  if (sub === "list") {
    const voices = listVoices();
    if (!voices.length) { console.log(`(没有克隆音色。用 'pipeline voice clone <音频>' 创建。)`); return; }
    console.log(`克隆音色(${voices.length}):\n`);
    for (const v of voices) {
      console.log(`  minimax:${v.voice_id}`);
      console.log(`    名称 ${v.label}   状态 ${fmtStatus(v)}`);
    }
    return;
  }

  if (sub === "keepalive") {
    const id = positional[0];
    if (!id) { console.error(`voice keepalive: 需要 voice id`); process.exit(1); }
    try {
      await keepaliveVoice(bareId(id));
      console.log(`✓ 已续期 minimax:${bareId(id)}(再 168h),并标记为永久`);
    } catch (e) {
      console.error(`✗ 续期失败: ${(e as CloneError).message}`);
      process.exit(1);
    }
    return;
  }

  if (sub === "rm") {
    const id = positional[0];
    if (!id) { console.error(`voice rm: 需要 voice id`); process.exit(1); }
    const ok = removeVoice(bareId(id));
    console.log(ok
      ? `✓ 已删除本地记录 minimax:${bareId(id)}  ⚠ 仅删本地,MiniMax 无远程删除 API`
      : `(没找到 ${id})`);
    return;
  }

  console.error(`未知子命令 'voice ${sub}'。可用: clone | list | keepalive | rm`);
  process.exit(1);
}
