import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const script = fs.readFileSync(path.resolve('scripts/deploy_to_prod.sh'), 'utf8');
const pushedReleaseScript = fs.readFileSync(path.resolve('scripts/deploy_pushed_release.sh'), 'utf8');

describe('production deployment recovery contract', () => {
    it('uses a release-specific image tag so a same-commit deploy cannot replace the rollback image', () => {
        expect(script).toContain('ANOTE_DEPLOY_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"');
        expect(script).toContain('ANOTE_IMAGE_TAG="${ANOTE_SHORT_SHA}-${ANOTE_DEPLOY_ID}"');
        expect(script).not.toContain('ANOTE_IMAGE_TAG="$ANOTE_SHORT_SHA"');
    });

    it('saves data and the active runtime configuration before cutover', () => {
        const backup = script.indexOf('scripts/backup_production.sh');
        const activeEnvironmentCopy = script.indexOf('cp "$ANOTE_ENV_FILE" "$ANOTE_BACKUP_DIR/production.env"');
        const activateCandidate = script.indexOf('mv "$ANOTE_CANDIDATE_ENV" "$ANOTE_ENV_FILE"');
        const cutover = script.indexOf('up -d --remove-orphans');

        expect(backup).toBeGreaterThan(-1);
        expect(activeEnvironmentCopy).toBeGreaterThan(backup);
        expect(activateCandidate).toBeGreaterThan(activeEnvironmentCopy);
        expect(cutover).toBeGreaterThan(activateCandidate);
    });

    it('defaults to main while allowing an explicitly selected pushed remote ref', () => {
        expect(script).toContain('ANOTE_DEPLOY_REMOTE_REF="${ANOTE_DEPLOY_REMOTE_REF:-origin/main}"');
        expect(script).toContain('refs/remotes/$ANOTE_DEPLOY_REMOTE_REF');
        expect(script).toContain('ANOTE_REMOTE_RELEASE_SHA="$(git rev-parse "$ANOTE_DEPLOY_REMOTE_REF")"');
        expect(script).toContain('if [[ "$ANOTE_GIT_SHA" != "$ANOTE_REMOTE_RELEASE_SHA" ]]');
    });

    it('deploys the exact pushed commit from an isolated release worktree', () => {
        const remoteEquality = pushedReleaseScript.indexOf('if [[ "$ANOTE_LOCAL_SHA" != "$ANOTE_REMOTE_SHA" ]]');
        const isolatedCheckout = pushedReleaseScript.indexOf('git worktree add --detach');
        const deploy = pushedReleaseScript.indexOf('ANOTE_DEPLOY_REMOTE_REF="$ANOTE_RELEASE_REF" npm run prod:deploy');

        expect(remoteEquality).toBeGreaterThan(-1);
        expect(isolatedCheckout).toBeGreaterThan(remoteEquality);
        expect(deploy).toBeGreaterThan(isolatedCheckout);
        expect(pushedReleaseScript).not.toContain('git reset');
    });
});
