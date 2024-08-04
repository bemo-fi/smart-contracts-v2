import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'func',
    targets: ['contracts/unstake_request.fc'],
};
