#!/usr/bin/env node
/**
 * drive.js - QwenPaw 智能体本地网盘插件
 * 
 * 纯本地硬盘实现，无需云服务。
 * 每个智能体拥有独立的存储空间，支持跨智能体文件共享。
 * 
 * 用法: node drive.js <command> [options]
 * 
 * 环境变量:
 *   QWENPAW_AGENT - 当前智能体ID（默认: default）
 *   QWENPAW_DRIVE - 网盘根目录（默认: ~/.qwenpaw/cloud_drive）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ==================== 配置 ====================
const DRIVE_ROOT = process.env.QWENPAW_DRIVE || path.join(os.homedir(), '.qwenpaw', 'cloud_drive');
const CURRENT_AGENT = (process.env.QWENPAW_AGENT || 'default').trim();
const SHARED_DIR = path.join(DRIVE_ROOT, '_shared');

const KNOWN_AGENTS = [
    'cloud-executor',
    'cloud-orchestrator',
    'cloud-verifier',
    'default',
    'news-pol-analyst',
    'QwenPaw_QA_Agent_0.2',
];

// ==================== 工具函数 ====================

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    for (const unit of units) {
        if (size < 1024) return `${size.toFixed(1)} ${unit}`;
        size /= 1024;
    }
    return `${size.toFixed(1)} PB`;
}

function getAgentDir(agentId) {
    const dir = path.join(DRIVE_ROOT, agentId);
    ensureDir(dir);
    return dir;
}

function getInboxDir(agentId) {
    const dir = path.join(getAgentDir(agentId), '_inbox');
    ensureDir(dir);
    return dir;
}

function walkDir(dir, callback, prefix = '') {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const fullPath = path.join(dir, entry);
        const relPath = prefix ? `${prefix}/${entry}` : entry;
        const stat = fs.statSync(fullPath);
        callback(fullPath, relPath, stat);
        if (stat.isDirectory()) walkDir(fullPath, callback, relPath);
    }
}

function output(data) {
    console.log(JSON.stringify(data, null, 2));
}

// ==================== 命令实现 ====================

function cmdUpload(args) {
    const localPath = args[0];
    if (!localPath) { console.error('❌ 请指定要上传的文件路径'); process.exit(1); }
    if (!fs.existsSync(localPath)) { console.error(`❌ 文件不存在: ${localPath}`); process.exit(1); }

    const cloudPath = args[1] || path.basename(localPath);
    const destPath = path.join(getAgentDir(CURRENT_AGENT), cloudPath);
    ensureDir(path.dirname(destPath));
    fs.copyFileSync(localPath, destPath);

    output({
        success: true,
        message: `✅ 上传成功`,
        agent: CURRENT_AGENT,
        path: cloudPath,
        size: fs.statSync(destPath).size,
        size_human: formatSize(fs.statSync(destPath).size),
    });
}

function cmdDownload(args) {
    const cloudPath = args[0];
    if (!cloudPath) { console.error('❌ 请指定要下载的文件路径'); process.exit(1); }

    const srcPath = path.join(getAgentDir(CURRENT_AGENT), cloudPath);
    if (!fs.existsSync(srcPath)) { console.error(`❌ 文件不存在: [${CURRENT_AGENT}]/${cloudPath}`); process.exit(1); }

    const destPath = args[1] || path.join(process.cwd(), path.basename(cloudPath));
    ensureDir(path.dirname(destPath));
    fs.copyFileSync(srcPath, destPath);

    output({
        success: true,
        message: `✅ 下载成功`,
        from: `[${CURRENT_AGENT}]/${cloudPath}`,
        to: destPath,
        size: fs.statSync(destPath).size,
        size_human: formatSize(fs.statSync(destPath).size),
    });
}

function cmdList(args) {
    const subPath = args[0] || '';
    const agentDir = getAgentDir(CURRENT_AGENT);
    const targetDir = subPath ? path.join(agentDir, subPath) : agentDir;

    if (!fs.existsSync(targetDir)) { console.error(`❌ 路径不存在: [${CURRENT_AGENT}]/${subPath}`); process.exit(1); }

    const stat = fs.statSync(targetDir);
    if (stat.isFile()) {
        output({
            success: true, agent: CURRENT_AGENT, path: subPath,
            file: { name: path.basename(subPath), size: stat.size, size_human: formatSize(stat.size), modified: stat.mtime.toISOString() }
        });
        return;
    }

    const entries = fs.readdirSync(targetDir).filter(e => !e.startsWith('.'));
    const files = entries.map(entry => {
        const fullPath = path.join(targetDir, entry);
        const entryStat = fs.statSync(fullPath);
        return {
            name: entry,
            type: entryStat.isDirectory() ? 'folder' : 'file',
            size: entryStat.size,
            size_human: formatSize(entryStat.size),
            modified: entryStat.mtime.toISOString(),
        };
    });

    output({ success: true, agent: CURRENT_AGENT, path: subPath || '/', files, total: files.length });
}

function cmdListAll() {
    const agents = KNOWN_AGENTS.map(agentId => {
        const agentDir = path.join(DRIVE_ROOT, agentId);
        if (!fs.existsSync(agentDir)) return { agent: agentId, file_count: 0, total_size: 0, total_size_human: '0.0 B', files: [] };
        const files = [];
        let totalSize = 0;
        walkDir(agentDir, (fullPath, relPath, stat) => {
            if (stat.isFile()) { files.push({ name: relPath, size: stat.size }); totalSize += stat.size; }
        });
        return { agent: agentId, file_count: files.length, total_size: totalSize, total_size_human: formatSize(totalSize), files: files.slice(0, 20) };
    });

    const shared = [];
    if (fs.existsSync(SHARED_DIR)) walkDir(SHARED_DIR, (fullPath, relPath, stat) => {
        if (stat.isFile()) shared.push({ name: relPath, size: stat.size });
    });

    output({ success: true, agents, shared });
}

function cmdDelete(args) {
    const cloudPath = args[0];
    if (!cloudPath) { console.error('❌ 请指定要删除的文件路径'); process.exit(1); }

    const targetPath = path.join(getAgentDir(CURRENT_AGENT), cloudPath);
    if (!fs.existsSync(targetPath)) { console.error(`❌ 文件不存在: [${CURRENT_AGENT}]/${cloudPath}`); process.exit(1); }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) fs.rmSync(targetPath, { recursive: true });
    else fs.unlinkSync(targetPath);

    output({ success: true, message: `✅ 已删除: [${CURRENT_AGENT}]${cloudPath}` });
}

function cmdShare(args) {
    const cloudPath = args[0];
    const toIdx = args.indexOf('--to');
    const toAgent = toIdx !== -1 ? args[toIdx + 1] : null;

    if (!cloudPath) { console.error('❌ 请指定要分享的文件路径'); process.exit(1); }
    if (!toAgent) { console.error('❌ 请指定目标智能体: --to <agent_id>'); process.exit(1); }

    const srcPath = path.join(getAgentDir(CURRENT_AGENT), cloudPath);
    if (!fs.existsSync(srcPath)) { console.error(`❌ 文件不存在: [${CURRENT_AGENT}]/${cloudPath}`); process.exit(1); }

    const inboxDir = getInboxDir(toAgent);
    const filename = path.basename(cloudPath);
    let destPath = path.join(inboxDir, filename);
    if (fs.existsSync(destPath)) {
        const ext = path.extname(filename);
        const base = path.basename(filename, ext);
        destPath = path.join(inboxDir, `${base}_${Date.now()}${ext}`);
    }
    fs.copyFileSync(srcPath, destPath);

    ensureDir(SHARED_DIR);
    const sharedPath = path.join(SHARED_DIR, `${CURRENT_AGENT}_${filename}`);
    fs.copyFileSync(srcPath, sharedPath);

    output({
        success: true,
        message: `✅ 分享成功`,
        from: `[${CURRENT_AGENT}]/${cloudPath}`,
        to: `[${toAgent}]/_inbox/${path.basename(destPath)}`,
        shared_copy: `_shared/${CURRENT_AGENT}_${filename}`,
    });
}

function cmdSearch(args) {
    const keyword = args[0];
    if (!keyword) { console.error('❌ 请指定搜索关键词'); process.exit(1); }

    const results = [];
    const searchDirs = [{ agent: CURRENT_AGENT, dir: getAgentDir(CURRENT_AGENT) }];
    if (fs.existsSync(SHARED_DIR)) searchDirs.push({ agent: '_shared', dir: SHARED_DIR });

    for (const { agent, dir } of searchDirs) {
        walkDir(dir, (fullPath, relPath, stat) => {
            if (relPath.toLowerCase().includes(keyword.toLowerCase())) {
                results.push({ agent, name: path.basename(relPath), path: relPath, size: stat.size, size_human: formatSize(stat.size), type: stat.isDirectory() ? 'folder' : 'file' });
            }
        });
    }

    output({ success: true, keyword, results, total: results.length });
}

function cmdQuota() {
    const agents = KNOWN_AGENTS.map(agentId => {
        const agentDir = path.join(DRIVE_ROOT, agentId);
        if (!fs.existsSync(agentDir)) return { agent: agentId, file_count: 0, total_size: 0, total_size_human: '0.0 B' };
        let totalSize = 0, fileCount = 0;
        walkDir(agentDir, (fullPath, relPath, stat) => { if (stat.isFile()) { totalSize += stat.size; fileCount++; } });
        return { agent: agentId, file_count: fileCount, total_size: totalSize, total_size_human: formatSize(totalSize) };
    });

    const totalAll = agents.reduce((sum, a) => sum + a.total_size, 0);
    output({ success: true, agents, total_size: totalAll, total_size_human: formatSize(totalAll) });
}

function cmdMkdir(args) {
    const dirName = args[0];
    if (!dirName) { console.error('❌ 请指定目录名'); process.exit(1); }
    const targetPath = path.join(getAgentDir(CURRENT_AGENT), dirName);
    ensureDir(targetPath);
    output({ success: true, message: `✅ 目录已创建: [${CURRENT_AGENT}]${dirName}` });
}

function cmdTree() {
    const agentDir = getAgentDir(CURRENT_AGENT);
    const tree = { name: CURRENT_AGENT, type: 'folder', children: [] };

    function buildTree(dir, node, depth = 0) {
        if (depth > 5) return;
        const entries = fs.readdirSync(dir).filter(e => !e.startsWith('.'));
        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                const child = { name: entry, type: 'folder', children: [] };
                node.children.push(child);
                buildTree(fullPath, child, depth + 1);
            } else {
                node.children.push({ name: entry, type: 'file', size: stat.size, size_human: formatSize(stat.size) });
            }
        }
    }

    buildTree(agentDir, tree);
    output({ success: true, tree });
}

function cmdInfo() {
    const agentDirs = {};
    for (const agentId of KNOWN_AGENTS) agentDirs[agentId] = fs.existsSync(path.join(DRIVE_ROOT, agentId));

    output({
        success: true,
        drive_root: DRIVE_ROOT,
        current_agent: CURRENT_AGENT,
        agents: agentDirs,
        shared: fs.existsSync(SHARED_DIR),
    });
}

function cmdMove(args) {
    const [src, dst] = args;
    if (!src || !dst) { console.error('❌ 请指定源路径和目标路径'); process.exit(1); }

    const agentDir = getAgentDir(CURRENT_AGENT);
    const srcPath = path.join(agentDir, src);
    const dstPath = path.join(agentDir, dst);
    if (!fs.existsSync(srcPath)) { console.error(`❌ 源文件不存在: [${CURRENT_AGENT}]${src}`); process.exit(1); }

    ensureDir(path.dirname(dstPath));
    fs.renameSync(srcPath, dstPath);
    output({ success: true, message: `✅ 已移动: [${CURRENT_AGENT}]${src} → [${CURRENT_AGENT}]${dst}` });
}

function cmdCopy(args) {
    const [src, dst] = args;
    if (!src || !dst) { console.error('❌ 请指定源路径和目标路径'); process.exit(1); }

    const agentDir = getAgentDir(CURRENT_AGENT);
    const srcPath = path.join(agentDir, src);
    const dstPath = path.join(agentDir, dst);
    if (!fs.existsSync(srcPath)) { console.error(`❌ 源文件不存在: [${CURRENT_AGENT}]${src}`); process.exit(1); }

    ensureDir(path.dirname(dstPath));
    fs.copyFileSync(srcPath, dstPath);
    output({ success: true, message: `✅ 已复制: [${CURRENT_AGENT}]${src} → [${CURRENT_AGENT}]${dst}` });
}

// ==================== CLI 入口 ====================

function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command || command === 'help' || command === '--help') {
        console.log(`
🏠 QwenPaw 智能体本地网盘插件
================================

当前智能体: ${CURRENT_AGENT}
网盘根目录: ${DRIVE_ROOT}

命令:
  upload   <local_file> [cloud_path]   上传文件
  download <cloud_path> [local_path]   下载文件
  list     [dir_path]                  列出文件
  list --all                           列出所有智能体空间
  delete   <cloud_path>                删除文件
  share    <cloud_path> --to <agent>   分享给其他智能体
  search   <keyword>                   搜索文件
  quota                                查看存储用量
  mkdir    <dirname>                   创建目录
  tree                                 显示目录树
  move     <src> <dst>                 移动/重命名
  copy     <src> <dst>                 复制文件
  info                                 查看网盘信息

环境变量:
  QWENPAW_AGENT - 当前智能体ID (当前: ${CURRENT_AGENT})
  QWENPAW_DRIVE - 网盘根目录 (当前: ${DRIVE_ROOT})
`);
        return;
    }

    const cmdArgs = args.slice(1);

    switch (command) {
        case 'upload':   cmdUpload(cmdArgs); break;
        case 'download': cmdDownload(cmdArgs); break;
        case 'list':
        case 'ls':       cmdArgs[0] === '--all' ? cmdListAll() : cmdList(cmdArgs); break;
        case 'list-all': cmdListAll(); break;
        case 'delete':
        case 'rm':       cmdDelete(cmdArgs); break;
        case 'share':    cmdShare(cmdArgs); break;
        case 'search':   cmdSearch(cmdArgs); break;
        case 'quota':    cmdQuota(); break;
        case 'mkdir':    cmdMkdir(cmdArgs); break;
        case 'tree':     cmdTree(cmdArgs); break;
        case 'info':     cmdInfo(); break;
        case 'move':     cmdMove(cmdArgs); break;
        case 'copy':     cmdCopy(cmdArgs); break;
        default:         console.error(`❌ 未知命令: ${command}`); process.exit(1);
    }
}

main();
