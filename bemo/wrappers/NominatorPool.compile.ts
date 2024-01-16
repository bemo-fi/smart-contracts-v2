import { CompilerConfig } from '@ton-community/blueprint';

export const compile: CompilerConfig = {
    targets: ['contracts/imports/stdlib_for_pool.fc', 'contracts/nominator_pool.fc'],
};
