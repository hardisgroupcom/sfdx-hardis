/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  formatTriggeringUserLabel,
  getTriggeringUser,
  isIdentifiableEmail,
  isIdentifiableName,
} from '../../../src/common/utils/triggeringUserUtils.js';

// Every source the resolver can read, cleared before each test so the developer machine
// environment (a real GITHUB_TOKEN, a CI flag...) cannot leak into the assertions
const RESOLVER_ENV_VARS = [
  'SFDX_HARDIS_TRIGGERED_BY',
  'GITHUB_TRIGGERING_ACTOR',
  'GITHUB_ACTOR',
  'GITHUB_TOKEN',
  'CI_SFDX_HARDIS_GITHUB_TOKEN',
  'PAT',
  'GITLAB_USER_NAME',
  'GITLAB_USER_EMAIL',
  'BUILD_REQUESTEDFOR',
  'BUILD_REQUESTEDFOREMAIL',
  'JENKINS_URL',
  'JENKINS_HOME',
  'BUILD_USER',
  'BUILD_USER_EMAIL',
  'CHANGE_AUTHOR',
  'CHANGE_AUTHOR_DISPLAY_NAME',
  'CHANGE_AUTHOR_EMAIL',
  'BITBUCKET_STEP_TRIGGERER_UUID',
  'CI_SFDX_HARDIS_BITBUCKET_TOKEN',
  'CI_USER_NAME',
  'CI_USER_EMAIL',
  'USER_EMAIL',
];

describe('triggeringUserUtils', () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of RESOLVER_ENV_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of RESOLVER_ENV_VARS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  describe('isIdentifiableName', () => {
    it('accepts a real display name or login', () => {
      expect(isIdentifiableName('Nicolas Vuillamy')).to.be.true;
      expect(isIdentifiableName('nvuillam')).to.be.true;
    });

    it('rejects empty and too short values', () => {
      expect(isIdentifiableName(null)).to.be.false;
      expect(isIdentifiableName(undefined)).to.be.false;
      expect(isIdentifiableName('')).to.be.false;
      expect(isIdentifiableName('   ')).to.be.false;
      expect(isIdentifiableName('x')).to.be.false;
    });

    it('rejects purely numeric OS logins', () => {
      expect(isIdentifiableName('33614')).to.be.false;
    });

    it('rejects opaque Bitbucket account UUIDs', () => {
      expect(isIdentifiableName('{c4c1a1b2-1234-4321-abcd-0123456789ab}')).to.be.false;
      expect(isIdentifiableName('c4c1a1b2-1234-4321-abcd-0123456789ab')).to.be.false;
    });

    it('rejects generic CI and service accounts, whatever the case', () => {
      expect(isIdentifiableName('runner')).to.be.false;
      expect(isIdentifiableName('root')).to.be.false;
      expect(isIdentifiableName('Jenkins')).to.be.false;
      expect(isIdentifiableName('github-actions[bot]')).to.be.false;
      expect(isIdentifiableName('Administrator')).to.be.false;
    });
  });

  describe('isIdentifiableEmail', () => {
    it('accepts well-formed addresses', () => {
      expect(isIdentifiableEmail('nicolas.vuillamy@gmail.com')).to.be.true;
      expect(isIdentifiableEmail('123456+nvuillam@users.noreply.github.com')).to.be.true;
    });

    it('rejects malformed values', () => {
      expect(isIdentifiableEmail(null)).to.be.false;
      expect(isIdentifiableEmail('')).to.be.false;
      expect(isIdentifiableEmail('nope')).to.be.false;
      expect(isIdentifiableEmail('user@host')).to.be.false;
      expect(isIdentifiableEmail('two words@example.com')).to.be.false;
    });
  });

  describe('formatTriggeringUserLabel', () => {
    it('combines name and email when both are known', () => {
      expect(formatTriggeringUserLabel({ name: 'Nicolas Vuillamy', email: 'nv@example.com' })).to.equal(
        'Nicolas Vuillamy (nv@example.com)'
      );
    });

    it('falls back to whichever value is available', () => {
      expect(formatTriggeringUserLabel({ name: 'Nicolas Vuillamy', email: null })).to.equal('Nicolas Vuillamy');
      expect(formatTriggeringUserLabel({ name: null, email: 'nv@example.com' })).to.equal('nv@example.com');
    });

    it('returns a non-empty label when nothing is known', () => {
      const label = formatTriggeringUserLabel({ name: null, email: null });
      expect(label).to.be.a('string');
      expect(label.length).to.be.greaterThan(0);
    });
  });

  describe('getTriggeringUser', () => {
    it('gives priority to the explicit override', async () => {
      process.env.SFDX_HARDIS_TRIGGERED_BY = 'Release Bot (release@example.com)';
      process.env.GITHUB_ACTOR = 'nvuillam';
      process.env.GITLAB_USER_NAME = 'Someone Else';
      const user = await getTriggeringUser();
      expect(user.source).to.equal('override');
      expect(user.label).to.equal('Release Bot (release@example.com)');
    });

    it('prefers the GitHub actor over other CI providers', async () => {
      process.env.GITHUB_ACTOR = 'nvuillam';
      process.env.GITLAB_USER_NAME = 'Someone Else';
      const user = await getTriggeringUser();
      expect(user.source).to.equal('github');
      expect(user.name).to.equal('nvuillam');
    });

    it('prefers the triggering actor over the workflow actor on GitHub', async () => {
      process.env.GITHUB_ACTOR = 'scheduler';
      process.env.GITHUB_TRIGGERING_ACTOR = 'nvuillam';
      const user = await getTriggeringUser();
      expect(user.name).to.equal('nvuillam');
    });

    it('reads name and email from GitLab', async () => {
      process.env.GITLAB_USER_NAME = 'Nicolas Vuillamy';
      process.env.GITLAB_USER_EMAIL = 'nv@example.com';
      const user = await getTriggeringUser();
      expect(user.source).to.equal('gitlab');
      expect(user.label).to.equal('Nicolas Vuillamy (nv@example.com)');
    });

    it('reads name and email from Azure Pipelines', async () => {
      process.env.BUILD_REQUESTEDFOR = 'Nicolas Vuillamy';
      process.env.BUILD_REQUESTEDFOREMAIL = 'nv@example.com';
      const user = await getTriggeringUser();
      expect(user.source).to.equal('azure');
      expect(user.name).to.equal('Nicolas Vuillamy');
    });

    it('ignores unresolved Azure variable expressions', async () => {
      process.env.BUILD_REQUESTEDFOR = '$(Build.RequestedFor)';
      process.env.CI_USER_NAME = 'Fallback User';
      const user = await getTriggeringUser();
      expect(user.source).to.equal('ciGeneric');
      expect(user.name).to.equal('Fallback User');
    });

    it('reads the Jenkins build user only when running on Jenkins', async () => {
      process.env.BUILD_USER = 'Nicolas Vuillamy';
      process.env.BUILD_USER_EMAIL = 'nv@example.com';
      process.env.CI_USER_NAME = 'Fallback User';
      const withoutJenkins = await getTriggeringUser();
      expect(withoutJenkins.source).to.equal('ciGeneric');

      process.env.JENKINS_URL = 'https://jenkins.example.com';
      const withJenkins = await getTriggeringUser();
      expect(withJenkins.source).to.equal('jenkins');
      expect(withJenkins.name).to.equal('Nicolas Vuillamy');
    });

    it('never exposes a raw Bitbucket account UUID', async () => {
      const uuid = '{c4c1a1b2-1234-4321-abcd-0123456789ab}';
      process.env.BITBUCKET_STEP_TRIGGERER_UUID = uuid;
      const user = await getTriggeringUser();
      expect(user.source).to.not.equal('bitbucket');
      expect(user.label).to.not.contain(uuid);
      expect(user.name).to.not.equal(uuid);
    });

    it('falls back to a generic CI identity when no provider matches', async () => {
      process.env.CI_USER_NAME = 'Nicolas Vuillamy';
      process.env.CI_USER_EMAIL = 'nv@example.com';
      const user = await getTriggeringUser();
      expect(user.source).to.equal('ciGeneric');
      expect(user.label).to.equal('Nicolas Vuillamy (nv@example.com)');
    });

    it('uses the sfdx-hardis USER_EMAIL convention for local runs', async () => {
      process.env.USER_EMAIL = 'nv@example.com';
      const user = await getTriggeringUser();
      expect(user.source).to.equal('sfdxHardisConfig');
      expect(user.email).to.equal('nv@example.com');
    });

    it('always returns a usable label and a boolean run context', async () => {
      const user = await getTriggeringUser();
      expect(user.label).to.be.a('string');
      expect(user.label.length).to.be.greaterThan(0);
      expect(user.isCiRun).to.be.a('boolean');
    });
  });
});
