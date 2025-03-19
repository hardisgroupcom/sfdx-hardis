import { Hook } from '@oclif/core';

const hook: Hook<'postrun'> = async (options) => {
  // Skip hooks from other commands than hardis commands
  const commandId = options?.Command?.id || '';
  if (!commandId.startsWith('hardis:scratch:create')) {
    return;
  }

  // Dynamic import to improve perfs
  const { copyLocalSfdxInfo } = await import('../../common/utils/index.js');

  // Copy local SFDX cache for CI
  await copyLocalSfdxInfo();
  return;
};

export default hook;
