import {toNano} from 'ton-core';
import {AdminMultisig} from '../wrappers/AdminMultisig';
import {mnemonicToPrivateKey} from "ton-crypto";
import {compile, NetworkProvider} from "@ton-community/blueprint";

export async function run(provider: NetworkProvider) {
    const mnemonic = [
        "gate cruise lucky monkey toilet come muffin square job hurry hair better tourist laptop drama long nest bomb blast surround recycle gas lounge hybrid",
        "conduct beyond strong garage nose three mammal slim spread leaf health digital trigger original crawl pilot fat attract suffer toilet float drum age print",
        "portion upgrade frequent borrow quantum govern rice swing merge light inflict primary cruise spike kiss robot city exhibit knife blade flip face vote coach"
    ]
    let publicKeys = []
    const n = 3;
    for (let i = 0; i < n; i++) {
        const ownerKeys = await mnemonicToPrivateKey(mnemonic[i].split(" "))
        publicKeys.push(ownerKeys.publicKey)
    }

    const adminMultisig = provider.open(AdminMultisig.createFromConfig({
        financialAddress: "EQAlo09uk_Q8eyfmejNobKNL-2nnQqkbFUrsDfrLXGoC71lA",
        k: n,
        publicKeys,
        walletId: 0
    }, await compile('AdminMultisig')));

    await adminMultisig.sendDeploy(provider.sender(), toNano('0.05'));

    await provider.waitForDeploy(adminMultisig.address);

    // run methods on `adminMultisig`

}
