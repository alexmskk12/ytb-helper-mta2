/**
 * FFS Radio - Helper Server
 * Versão Render - usa yt-dlp-exec (npm)
 */
const http      = require('http');
const url       = require('url');
const fs        = require('fs');
const path      = require('path');
const { execSync } = require('child_process');

const PORT         = process.env.PORT || 9876;
const HOST         = '0.0.0.0';
const CACHE        = new Map();
const CACHE_MARGIN = 300;

const COOKIES    = path.join(__dirname, 'cookies.txt');
const hasCookies = fs.existsSync(COOKIES);

let YTDLP_BIN;
try {
    YTDLP_BIN = require.resolve('yt-dlp-exec/bin/yt-dlp');
} catch(e) {
    YTDLP_BIN = path.join(__dirname, 'node_modules/yt-dlp-exec/bin/yt-dlp');
}
console.log('[yt-dlp] Binário:', YTDLP_BIN);

try {
    execSync(`"${YTDLP_BIN}" --update`, { stdio: 'inherit' });
} catch(e) {
    console.log('[yt-dlp] Update falhou, continuando...');
}

// ─── Resolver via execSync ────────────────────────────────
function resolveStreamUrl(videoId) {
    return new Promise((resolve, reject) => {
        const cached = CACHE.get(videoId);
        if (cached && cached.expires > Date.now() / 1000 + CACHE_MARGIN) {
            console.log(`[Cache HIT] ${videoId}`);
            return resolve(cached.url);
        }

        console.log(`[Resolvendo] ${videoId}`);

        // Tenta cada cliente em sequência até um funcionar
        const clientes = ['android', 'android_vr', 'tv_embedded'];

        for (const cliente of clientes) {
            try {
                const cookiesArg = hasCookies ? `--cookies "${COOKIES}"` : '';
                const cmd = `"${YTDLP_BIN}" --no-warnings --no-playlist --get-url -f bestaudio/best --extractor-args "youtube:player_client=${cliente}" ${cookiesArg} "https://www.youtube.com/watch?v=${videoId}" 2>&1`;

                console.log(`[Tentando cliente: ${cliente}]`);
                const output = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
                const streamUrl = output.trim().split('\n').find(l => l.startsWith('http'));

                if (streamUrl) {
                    const expireMatch = streamUrl.match(/expire=(\d+)/);
                    const expires = expireMatch ? parseInt(expireMatch[1]) : (Date.now() / 1000 + 3600);
                    CACHE.set(videoId, { url: streamUrl, expires });
                    console.log(`[Resolvido com ${cliente}] ${videoId}`);
                    return resolve(streamUrl);
                }
            } catch(e) {
                console.log(`[Cliente ${cliente} falhou]`, (e.stdout || e.message).substring(0, 150));
            }
        }

        reject(new Error('Todos os clientes falharam para: ' + videoId));
    });
}

// ─── HTTP Server ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    const parsed  = url.parse(req.url, true);
    const videoId = parsed.query.v;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (parsed.pathname === '/ping') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', cookies: hasCookies }));
        return;
    }

    if (parsed.pathname !== '/stream' || !videoId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Use /stream?v=VIDEO_ID' }));
        return;
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'videoId inválido' }));
        return;
    }

    try {
        const streamUrl = await resolveStreamUrl(videoId);
        res.writeHead(200);
        res.end(JSON.stringify({ url: streamUrl }));
    } catch (err) {
        console.error(`[ERRO] ${videoId}: ${err.message}`);
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
    }
});

// ─── Init ─────────────────────────────────────────────────
console.log(`[FFS Radio Helper] Cookies: ${hasCookies ? 'SIM ✓' : 'NÃO'}`);
server.listen(PORT, HOST, () => {
    console.log(`[FFS Radio Helper] Rodando em http://${HOST}:${PORT}`);
});

server.on('error', (e) => {
    console.error('[ERRO] Servidor:', e.message);
    process.exit(1);
});
