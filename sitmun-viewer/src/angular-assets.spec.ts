import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

type AssetEntry = string | { glob: string; input: string; output: string };

const viewerRoot = process.cwd();

function buildAssets(): AssetEntry[] {
  const angular = JSON.parse(
    readFileSync(path.join(viewerRoot, 'angular.json'), 'utf8')
  );
  const projects = Object.values(angular.projects) as Array<{
    architect: { build: { options: { assets: AssetEntry[] } } };
  }>;
  return projects.flatMap((p) => p.architect.build.options.assets);
}

// pnpm only links direct dependencies into sitmun-viewer/node_modules. An
// asset copied from a package that is only a transitive dependency copies
// nothing, and the viewer then gets index.html for that script (#361).
describe('angular.json assets copied from node_modules', () => {
  const entries = buildAssets().filter(
    (a): a is Exclude<AssetEntry, string> =>
      typeof a !== 'string' && a.input.startsWith('node_modules/')
  );

  it('has entries to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries.map((e) => [e.input, e.glob, e.output]))(
    '%s (%s) has files to copy to %s',
    (input, glob) => {
      const dir = path.join(viewerRoot, input);
      expect(existsSync(dir)).toBe(true);
      if (glob === '**/*') {
        expect(readdirSync(dir).length).toBeGreaterThan(0);
      } else {
        expect(existsSync(path.join(dir, glob))).toBe(true);
      }
    }
  );
});
