import {Address, toNano} from 'ton-core'
import {NetworkProvider, sleep} from '@ton-community/blueprint'
import {AdminMultisig} from "../wrappers/AdminMultisig";
import {mnemonicToPrivateKey} from "ton-crypto";
import {getChangeAdminMultisigPayload, getChangeTransactionMultisigPayload} from "../wrappers/utils/AdminMultisigUtils";
import {getOrderByPayload} from "../wrappers/utils/MultisigOrder";
import {Financial} from "../wrappers/Financial";

export async function run(provider: NetworkProvider) {

    // const fin = provider.open(Financial.createFromAddress(Address.parse("EQAlo09uk_Q8eyfmejNobKNL-2nnQqkbFUrsDfrLXGoC71lA")))
    //
    // await fin.sendChangeTransactionAdmin(provider.sender(), toNano("0.05"), {
    //     newTransactionAdminAddress: "EQAnFvBuzxq-evCLLJsrd5y9HpJ0lC9aH5_Tdx0m-RxoJfQn"
    // })

    const admin = provider.open(AdminMultisig.createFromAddress(Address.parse("EQBWIPQGzXky6ofEhK3-5720nbFAQPGNcBLSUstxL_u3aeMB")));

    const mnemonic = [
        "gate cruise lucky monkey toilet come muffin square job hurry hair better tourist laptop drama long nest bomb blast surround recycle gas lounge hybrid",
        "conduct beyond strong garage nose three mammal slim spread leaf health digital trigger original crawl pilot fat attract suffer toilet float drum age print",
        "portion upgrade frequent borrow quantum govern rice swing merge light inflict primary cruise spike kiss robot city exhibit knife blade flip face vote coach"
    ]

    const changeTransactionMultisigPayload = getChangeTransactionMultisigPayload("EQBpD7mQDcTWg2xdGWB_RttKJeDxawV4XS_K50F8mnL-Uzet")
    const changeTransactionMultisigOrder = getOrderByPayload(changeTransactionMultisigPayload)

    for (let i = 0; i < 3; i++) {
        const ownerKeys = await mnemonicToPrivateKey(mnemonic[i].split(" "))
        changeTransactionMultisigOrder.sign(i, ownerKeys.secretKey)
    }

    await admin.sendOrder(changeTransactionMultisigOrder, (await mnemonicToPrivateKey(mnemonic[0].split(" "))).secretKey, 0);

    await sleep(3000)

    console.log(await admin.getTempConfig())
}
