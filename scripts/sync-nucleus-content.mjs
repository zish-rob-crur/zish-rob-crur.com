import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const targetDoc = path.join(repoRoot, 'src', 'content', 'blog', 'introducing-nucleus.md');
const targetImages = path.join(repoRoot, 'public', 'nucleus', 'introducing-nucleus');
const targetHeroDir = path.join(repoRoot, 'src', 'content', 'blog', '_generated', 'introducing-nucleus');

const githubBase = 'https://github.com/zish-rob-crur/nucleus-apple-mcp';
const defaultSiteConfig = {
  title: 'Introducing Nucleus',
  description: 'A local-first personal data archive for people and agents, starting with Apple Health.',
  pubDate: '2026-03-22',
};

async function resolveSourceRoot() {
  const candidates = [
    path.resolve(repoRoot, '..', 'nucleus-apple-mcp'),
    path.join(repoRoot, 'external', 'nucleus-apple-mcp'),
  ];

  for (const candidate of candidates) {
    const sourceDoc = path.join(candidate, 'docs', 'introducing-nucleus.md');
    try {
      await access(sourceDoc);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    'Unable to find docs/introducing-nucleus.md in the submodule or sibling nucleus-apple-mcp checkout.',
  );
}

function isMissingFileError(error) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function yamlValue(value) {
  return JSON.stringify(value);
}

function validateSiteConfig(config, configPath) {
  for (const key of ['title', 'description', 'pubDate']) {
    if (typeof config[key] !== 'string' || config[key].trim() === '') {
      throw new Error(`Invalid ${key} in ${path.relative(repoRoot, configPath)}.`);
    }
  }

  for (const key of ['updatedDate', 'heroImage']) {
    if (config[key] != null && (typeof config[key] !== 'string' || config[key].trim() === '')) {
      throw new Error(`Invalid ${key} in ${path.relative(repoRoot, configPath)}.`);
    }
  }

  return config;
}

async function readSiteConfig(sourceRoot) {
  const configPath = path.join(sourceRoot, 'docs', 'introducing-nucleus.site.json');

  try {
    const rawConfig = await readFile(configPath, 'utf8');
    return {
      configPath,
      config: validateSiteConfig(
        {
          ...defaultSiteConfig,
          ...JSON.parse(rawConfig),
        },
        configPath,
      ),
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        configPath,
        config: validateSiteConfig(defaultSiteConfig, configPath),
      };
    }

    throw error;
  }
}

async function syncHeroImage(configPath, heroImage) {
  await rm(targetHeroDir, { recursive: true, force: true });

  if (!heroImage) {
    return null;
  }

  const sourceHeroPath = path.resolve(path.dirname(configPath), heroImage);

  try {
    await access(sourceHeroPath);
  } catch (error) {
    if (isMissingFileError(error)) {
      console.warn(
        `Hero image not found at ${path.relative(repoRoot, sourceHeroPath)}. Skipping article cover.`,
      );
      return null;
    }

    throw error;
  }

  const extension = path.extname(sourceHeroPath);
  const targetHeroPath = path.join(targetHeroDir, `hero${extension}`);

  await mkdir(targetHeroDir, { recursive: true });
  await cp(sourceHeroPath, targetHeroPath);

  return `./_generated/introducing-nucleus/hero${extension}`;
}

function buildFrontmatter(siteConfig, heroImagePath) {
  const frontmatter = [
    '---',
    `title: ${yamlValue(siteConfig.title)}`,
    `description: ${yamlValue(siteConfig.description)}`,
    `pubDate: ${yamlValue(siteConfig.pubDate)}`,
  ];

  if (siteConfig.updatedDate) {
    frontmatter.push(`updatedDate: ${yamlValue(siteConfig.updatedDate)}`);
  }

  if (heroImagePath) {
    frontmatter.push(`heroImage: ${yamlValue(heroImagePath)}`);
  }

  frontmatter.push('---', '');
  return frontmatter.join('\n');
}

async function main() {
  const sourceRoot = await resolveSourceRoot();
  const sourceDoc = path.join(sourceRoot, 'docs', 'introducing-nucleus.md');
  const sourceImages = path.join(sourceRoot, 'docs', 'images', 'introducing-nucleus');
  const { configPath, config: siteConfig } = await readSiteConfig(sourceRoot);
  const heroImagePath = await syncHeroImage(configPath, siteConfig.heroImage);
  let markdown = await readFile(sourceDoc, 'utf8');

  markdown = markdown.replaceAll(
    'src="images/introducing-nucleus/',
    'src="/nucleus/introducing-nucleus/',
  );
  markdown = markdown.replace(
    '[docs/specs/health.md](specs/health.md)',
    `[docs/specs/health.md](${githubBase}/blob/main/docs/specs/health.md)`,
  );
  markdown = markdown.replace(
    '[docs/getting-started.md](getting-started.md)',
    `[docs/getting-started.md](${githubBase}/blob/main/docs/getting-started.md)`,
  );
  markdown = markdown.replace(
    '[`skills/`](../skills/)',
    `[\`skills/\`](${githubBase}/tree/main/skills)`,
  );

  const banner = [
    '<!--',
    '  This file is generated by scripts/sync-nucleus-content.mjs.',
    `  Source of truth: ${path.relative(repoRoot, sourceDoc)}`,
    '-->',
    '',
  ].join('\n');
  const frontmatter = buildFrontmatter(siteConfig, heroImagePath);
  markdown = `${frontmatter}${banner}${markdown}`;

  await mkdir(path.dirname(targetDoc), { recursive: true });
  await mkdir(path.dirname(targetImages), { recursive: true });
  await rm(targetImages, { recursive: true, force: true });
  await mkdir(targetImages, { recursive: true });

  await cp(sourceImages, targetImages, { recursive: true });
  await writeFile(targetDoc, markdown, 'utf8');

  console.log(`Synced Nucleus content from ${path.relative(repoRoot, sourceRoot)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
