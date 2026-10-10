import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const accessConfig = {
  teamDomain: 'synthetic-team.cloudflareaccess.com',
  audience: 'synthetic-app-audience',
  email: 'ado-e2e@example.invalid',
  origin: 'https://kaiwa.adonain.dev',
};

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

function fixtureTokens(privateKey, lifetimeSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: `https://${accessConfig.teamDomain}`,
    aud: [accessConfig.audience], email: accessConfig.email,
    iat: now, exp: now + lifetimeSeconds, type: 'app', sub: 'synthetic-e2e-user',
  };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = (changes = {}, header = {}) => {
    const payload = { ...claims, ...changes };
    for (const [key, value] of Object.entries(payload)) {
      if (value === null) delete payload[key];
    }
    const input = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'synthetic-e2e-key', ...header })}.${encode(payload)}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
  };
  const valid = token();
  const forged = `${valid.slice(0, valid.lastIndexOf('.') + 1)}${Buffer.alloc(256).toString('base64url')}`;
  return {
    valid, forged, malformed: 'not-a-jwt', wrongEmail: token({ email: 'someone-else@example.invalid' }),
    wrongAudience: token({ aud: ['another-app'] }), wrongIssuer: token({ iss: 'https://other.cloudflareaccess.com' }),
    expired: token({ exp: now - 60 }), notYetValid: token({ nbf: now + 3600 }),
    missingExpiry: token({ exp: null }), missingEmail: token({ email: null }),
    missingIssuedAt: token({ iat: null }), missingAudience: token({ aud: null }), missingIssuer: token({ iss: null }),
    serviceToken: token({ type: 'service' }), wrongAlgorithm: token({}, { alg: 'HS256' }),
    unknownSigningKey: token({}, { kid: 'unknown-synthetic-key' }),
  };
}

/** Real TLS/JWKS transport; the production verifier keeps its fixed Cloudflare URL. */
export async function createAccessFixture(onControl) {
  const directory = await mkdtemp(join(tmpdir(), 'kaiwa-access-e2e-'));
  let tls;
  let proxy;
  const sockets = new Set();
  try {
    const certificate = join(directory, 'synthetic-ca.pem');
    const tlsKey = join(directory, 'synthetic-tls.key');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', `/CN=${accessConfig.teamDomain}`,
      '-addext', `subjectAltName=DNS:${accessConfig.teamDomain}`,
      '-keyout', tlsKey, '-out', certificate,
    ], { stdio: 'ignore' });
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-e2e-key', alg: 'RS256', use: 'sig' };
    let jwksRequests = 0;
    tls = createHttpsServer({ key: await readFile(tlsKey), cert: await readFile(certificate) }, (request, response) => {
      if (request.url !== '/cdn-cgi/access/certs') {
        response.writeHead(404).end();
        return;
      }
      jwksRequests += 1;
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [publicJwk] }));
    });
    const tlsPort = await listen(tls);
    proxy = createHttpServer(async (request, response) => {
      try {
        const result = await onControl(request.url);
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }));
      }
    });
    proxy.on('connect', (request, client, head) => {
      if (request.url !== `${accessConfig.teamDomain}:443`) {
        client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }
      sockets.add(client);
      client.on('close', () => sockets.delete(client));
      const upstream = connect(tlsPort, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
      client.on('close', () => upstream.destroy());
    });
    const proxyPort = await listen(proxy);
    return {
      directory, certificate, tokens: fixtureTokens(privateKey),
      shortLivedToken: () => fixtureTokens(privateKey, 3).valid,
      proxyUrl: `http://127.0.0.1:${proxyPort}`,
      jwksRequests: () => jwksRequests,
      async close() {
        for (const socket of sockets) socket.destroy();
        await close(proxy);
        await close(tls);
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    if (proxy) await close(proxy);
    if (tls) await close(tls);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
