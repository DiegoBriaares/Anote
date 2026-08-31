import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');


describe('production gateway content security policy', () => {
    it('permits configured HTTPS backgrounds without broadening active content sources', () => {
        const nginx = fs.readFileSync(path.join(repositoryRoot, 'docker', 'nginx.conf'), 'utf8');
        const policies = [...nginx.matchAll(/Content-Security-Policy "([^"]+)"/g)]
            .map((match) => match[1]);
        const applicationPolicies = policies.filter((policy) => policy.includes("default-src 'self'"));

        expect(applicationPolicies).toHaveLength(3);
        for (const policy of applicationPolicies) {
            expect(policy).toContain("img-src 'self' https: data: blob:");
            expect(policy).toContain("script-src 'self'");
            expect(policy).toContain("object-src 'none'");
            expect(policy).not.toContain('http:');
        }
    });

    it('normalizes one complete external origin and rejects ambiguous forwarding', () => {
        const gateway = fs.readFileSync(path.join(repositoryRoot, 'docker', 'nginx.conf'), 'utf8');
        const nginxMain = fs.readFileSync(path.join(repositoryRoot, 'control_center', 'release', 'nginx-main.conf'), 'utf8');

        expect(nginxMain).toContain('map "$http_x_forwarded_proto|$http_x_forwarded_host" $anote_forwarding_state');
        expect(nginxMain).toContain('default invalid;');
        expect(nginxMain).toContain('direct $scheme;');
        expect(gateway).toContain('if ($anote_forwarding_state = invalid)');
        expect(gateway.match(/proxy_set_header Host \$anote_effective_host;/g)).toHaveLength(2);
        expect(gateway.match(/proxy_set_header X-Forwarded-Proto \$anote_effective_proto;/g)).toHaveLength(2);
        expect(gateway.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g)).toHaveLength(2);
    });
});
