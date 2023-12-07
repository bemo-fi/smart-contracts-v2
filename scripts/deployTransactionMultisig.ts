import {toNano} from 'ton-core';
import { TransactionMultisig } from '../wrappers/TransactionMultisig';
import { compile, NetworkProvider } from '@ton-community/blueprint';
import {mnemonicToPrivateKey} from "ton-crypto";

export async function run(provider: NetworkProvider) {
    const mnemonic = [
        "few escape silent judge hard method powder woman olympic absurd stereo smooth swing flame weather total canvas type patch eternal joy river artwork wise",
        "possible load ignore become coffee wagon pass knee kingdom disease uniform misery strike use cook describe member trend case umbrella soccer museum lazy throw",
        "page similar announce unique mobile document bounce senior enact fiber congress portion flame disorder walk nothing tower mixture neck enact purpose bubble nature any"
    ]

    let publicKeys = []
    const n = 3;
    for (let i = 0; i < n; i++) {
        const ownerKeys = await mnemonicToPrivateKey(mnemonic[i].split(" "))
        publicKeys.push(ownerKeys.publicKey)
    }


    const transactionMultisig = provider.open(TransactionMultisig.createFromConfig({
        financialAddress: "EQAlo09uk_Q8eyfmejNobKNL-2nnQqkbFUrsDfrLXGoC71lA",
        k: n,
        poolCode: await compile('NominatorPool'),
        proxyCode: await compile('NominatorProxy'),
        publicKeys,
        walletId: 0
    }, await compile('TransactionMultisig')));

    await transactionMultisig.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(transactionMultisig.address);

    // run methods on `transactionMultisig`
}
