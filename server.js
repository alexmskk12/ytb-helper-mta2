/**
 * FFS Radio - Helper Server (yt-dlp edition)
 * Versão Linux/Railway - baixa o yt-dlp automaticamente
 *
 * Rodar: node server.js
 */

const http     = require('http');
const url      = require('url');
const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const { execFile, exec } = require('child_process');

const PORT         = process.env.PORT || 9876;
const HOST         = '0.0.0.0';
const CACHE        = new Map();
const CACHE_MARGIN = 300;

const YTDLP = path.join(__dirname, 'yt-dlp');

// ─── Download yt-dlp Linux se não existir ─────────────────
function downloadYtDlp() {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(YTDLP)) {
            console.log('[FFS Radio Helper] yt-dlp encontrado!');
            return resolve();
        }

        console.log('[FFS Radio Helper] Baixando yt-dlp para Linux...');
        const file = fs.createWriteStream(YTDLP);
        const ytdlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';

        https.get(ytdlpUrl, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                https.get(res.headers.location, (res2) => {
                    res2.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        fs.chmodSync(YTDLP, '755');
                        console.log('[FFS Radio Helper] yt-dlp baixado com sucesso!');
                        resolve();
                    });
                }).on('error', reject);
            } else {
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    fs.chmodSync(YTDLP, '755');
                    console.log('[FFS Radio Helper] yt-dlp baixado com sucesso!');
                    resolve();
                });
            }
        }).on('error', (err) => {
            fs.unlink(YTDLP, () => {});
            reject(err);
        });
    });
}

const COOKIES  = path.join(__dirname, 'cookies.txt');
const hasCookies = fs.existsSync(COOKIES);

// ─── Resolver via yt-dlp ──────────────────────────────────
function resolveStreamUrl(videoId) {
    return new Promise((resolve, reject) => {
        const cached = CACHE.get(videoId);
        if (cached && cached.expires > Date.now() / 1000 + CACHE_MARGIN) {
            console.log(`[Cache HIT] ${videoId}`);
            return resolve(cached.url);
        }

        console.log(`[Resolvendo] ${videoId}`);

        const args = [
            '--no-warnings',
            '--no-playlist',
            '-f', 'bestaudio/best',
            '--get-url',
        ];

        if (hasCookies) args.push('--cookies', COOKIES);

        args.push(`https://www.youtube.com/watch?v=${videoId}`);

execFile(YTDLP, args, { timeout: 30000 }, (err, stdout, stderr) => {
    console.log('[yt-dlp stdout]', stdout.trim().substring(0, 300));
    console.log('[yt-dlp stderr]', stderr.trim().substring(0, 300));
    if (err) {
        console.error('[yt-dlp ERRO]', err.message);
        return reject(new Error(stderr.trim() || err.message));
    }

            const streamUrl = stdout.trim().split('\n')[0];
            if (!streamUrl || !streamUrl.startsWith('http')) {
                return reject(new Error('URL inválida retornada pelo yt-dlp'));
            }

            const expireMatch = streamUrl.match(/expire=(\d+)/);
            const expires = expireMatch ? parseInt(expireMatch[1]) : (Date.now() / 1000 + 3600);

            CACHE.set(videoId, { url: streamUrl, expires });
            console.log(`[Resolvido] ${videoId} | expire=${new Date(expires * 1000).toISOString()}`);
            resolve(streamUrl);
        });
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
        const status = err.message.includes('429') ? 429
                     : err.message.includes('410') ? 410
                     : 500;
        res.writeHead(status);
        res.end(JSON.stringify({ error: err.message }));
    }
});

// ─── Init ─────────────────────────────────────────────────
downloadYtDlp().then(() => {
    console.log(`[FFS Radio Helper] Cookies: ${hasCookies ? 'SIM ✓' : 'NÃO'}`);
    server.listen(PORT, HOST, () => {
        console.log(`[FFS Radio Helper] Rodando em http://${HOST}:${PORT}`);
    });
}).catch((err) => {
    console.error('[ERRO] Falha ao baixar yt-dlp:', err.message);
    process.exit(1);
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`[ERRO] Porta ${PORT} já em uso.`);
    } else {
        console.error('[ERRO] Servidor:', e.message);
    }
    process.exit(1);
});
