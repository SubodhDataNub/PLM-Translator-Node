'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const YAML = require('yaml');

const root = path.join(__dirname, '..');
const mta = YAML.parse(fs.readFileSync(path.join(root, 'mta.yaml'), 'utf8'));
const stage = path.join(root, '.mta', 'stage');
const outDir = path.join(root, 'mta_archives');
const outFile = path.join(outDir, `${mta.ID}_${mta.version}.mtar`);

function run(command, cwd) {
    console.log(`\n> ${command}   [${path.relative(root, cwd) || '.'}]`);
    execSync(command, { cwd, stdio: 'inherit' });
}

function findTar() {
    if (process.platform === 'win32') {
        return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    }
    const version = execFileSync('tar', ['--version']).toString();
    if (!/bsdtar/.test(version)) {
        throw new Error('This script needs bsdtar to write zip files. On Linux, use "npm run build:mbt" instead.');
    }
    return 'tar';
}

const tar = findTar();

function zip(cwd, entries, zipFile) {
    if (entries.length === 0) throw new Error(`Nothing to package in ${cwd}`);
    fs.mkdirSync(path.dirname(zipFile), { recursive: true });
    execFileSync(tar, ['--format', 'zip', '-c', '-f', zipFile, '-C', cwd, ...entries], { stdio: 'inherit' });
}

function zipDir(dir, zipFile) {
    zip(dir, fs.readdirSync(dir), zipFile);
}

const buildOnly = (module) => {
    const platforms = module['build-parameters'] && module['build-parameters']['supported-platforms'];
    return module.type === 'html5' && Array.isArray(platforms) && platforms.length === 0;
};

for (const step of (mta['build-parameters'] && mta['build-parameters']['before-all']) || []) {
    for (const command of step.commands || []) run(command, root);
}

const buildResults = {};
for (const module of mta.modules.filter((m) => m.type === 'html5')) {
    const params = module['build-parameters'] || {};
    const dir = path.join(root, module.path);
    for (const command of params.commands || []) run(command, dir);
    buildResults[module.name] = path.join(dir, params['build-result'] || 'dist');
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'META-INF'), { recursive: true });

const manifest = ['manifest-Version: 1.0', 'Created-By: scripts/build-mtar.js', ''];
const deployModules = [];

for (const module of mta.modules.filter((m) => !buildOnly(m))) {
    const params = module['build-parameters'] || {};
    const descriptor = { ...module };
    delete descriptor['build-parameters'];
    if (descriptor.type === 'hdb') descriptor.type = 'com.sap.xs.hdi';

    if (params['no-source']) {
        delete descriptor.path;
        deployModules.push(descriptor);
        continue;
    }

    const sourceDir = path.join(root, module.path);
    if (params.builder === 'npm-ci') run('npm ci --omit=dev --no-audit --no-fund', sourceDir);
    else if (module.type === 'hdb') run('npm install --omit=dev --no-audit --no-fund', sourceDir);

    let contentDir = sourceDir;
    let entry = `${module.name}/data.zip`;
    if (params['build-result']) {
        contentDir = path.join(sourceDir, params['build-result']);
        fs.rmSync(contentDir, { recursive: true, force: true });
        for (const required of params.requires || []) {
            const target = path.join(sourceDir, required['target-path'] || '');
            fs.mkdirSync(target, { recursive: true });
            for (const artifact of required.artifacts || []) {
                fs.copyFileSync(path.join(buildResults[required.name], artifact), path.join(target, artifact));
            }
        }
        entry = `${module.name}/${params['build-result'].replace(/\/+$/, '')}/data.zip`;
    }

    zipDir(contentDir, path.join(stage, entry));
    manifest.push(`Name: ${entry}`, `MTA-Module: ${module.name}`, 'Content-Type: application/zip', '');
    descriptor.path = module.name;
    deployModules.push(descriptor);
}

for (const resource of mta.resources || []) {
    const file = resource.parameters && resource.parameters.path;
    if (!file) continue;
    const name = path.normalize(file).replace(/\\/g, '/');
    fs.mkdirSync(path.dirname(path.join(stage, name)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(stage, name));
    const type = name.endsWith('.json') ? 'application/json' : 'text/plain';
    manifest.push(`Name: ${name}`, `MTA-Resource: ${resource.name}`, `Content-Type: ${type}`, '');
}

const mtad = { ...mta, modules: deployModules };
delete mtad['build-parameters'];
fs.writeFileSync(path.join(stage, 'META-INF', 'mtad.yaml'), YAML.stringify(mtad, { lineWidth: 0 }));
manifest.push('Name: META-INF/mtad.yaml', 'Content-Type: text/plain', '');
fs.writeFileSync(path.join(stage, 'META-INF', 'MANIFEST.MF'), `${manifest.join('\n')}\n`);

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(outFile, { force: true });
const rest = fs.readdirSync(stage).filter((entry) => entry !== 'META-INF');
zip(stage, ['META-INF/MANIFEST.MF', 'META-INF/mtad.yaml', ...rest], outFile);

console.log(`\nBuilt ${path.relative(root, outFile)} (${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB)`);
console.log(`Deploy it with: npm run deploy:cf`);
