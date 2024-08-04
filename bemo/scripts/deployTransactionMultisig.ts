import {Cell, toNano} from '@ton/core';
import {TransactionMultisig} from '../wrappers/TransactionMultisig';
import {compile, NetworkProvider} from '@ton/blueprint';
import {NominatorPoolCodeBase64} from "../wrappers/NominatorPool";

export async function run(provider: NetworkProvider) {

    let publicKeys = []
    const n = 4;
    publicKeys.push(Buffer.from("132312D67828FCD1A7CEA2908D02FE73CD0B4682C957369F3E5E9F0B890368CC", "hex"))
    publicKeys.push(Buffer.from("B27CD13F8876D8F174F95F791712D3E3FF0F1DC0135FE880C28B3413E5A46A60", "hex"))
    publicKeys.push(Buffer.from("9468A419B234A1E12AB4119B4DEB5352A40A4B74D03878DF133FF398416E0829", "hex"))
    publicKeys.push(Buffer.from("89EB12EE30C863A6DACC5A23F44130B9EB183C98AEEABFC30944ACB100863557", "hex"))

    const poolCode = Cell.fromBase64(NominatorPoolCodeBase64);

    const transactionMultisig = provider.open(TransactionMultisig.createFromConfig({
        financialAddress: "EQDNhy-nxYFgUqzfUzImBEP67JqsyMIcyk2S5_RwNNEYku0k",
        k: n,
        poolCode: poolCode,
        proxyCode: await compile('NominatorProxy'),
        publicKeys,
        walletId: 0
    }, await compile('TransactionMultisig')));

    // POSTMORTEM
    // const transactionMultisig = provider.open(TransactionMultisig.createFromConfig({
    //     financialAddress: "EQDNhy-nxYFgUqzfUzImBEP67JqsyMIcyk2S5_RwNNEYku0k",
    //     k: n,
    //     poolCode: await compile('NominatorPool'),
    //     proxyCode: await compile('NominatorProxy'),
    //     publicKeys,
    //     walletId: 0
    // }, await compile('TransactionMultisig')));

    console.log('---------------------------------');
    console.log('TRANSACTION MULTISIG ADDRESS:', transactionMultisig.address.toString())
    console.log('---------------------------------');

    await transactionMultisig.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(transactionMultisig.address);
}
