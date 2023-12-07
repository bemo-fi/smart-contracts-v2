import {Address} from 'ton-core'
import {NetworkProvider} from '@ton-community/blueprint'
import {AdminMultisig} from "../wrappers/AdminMultisig";
import {mnemonicToPrivateKey} from "ton-crypto";
import { getSendCommissionPayload} from "../wrappers/utils/AdminMultisigUtils";
import {getOrderByPayload} from "../wrappers/utils/MultisigOrder";

export async function run(provider: NetworkProvider) {
    const admin = provider.open(AdminMultisig.createFromAddress(Address.parse("EQBWEjPhNqknH3FtoZu9Dl0kTYFK6LgrE0rSlI8EWLllp0Ex")));

    const mnemonic = [
        "gate cruise lucky monkey toilet come muffin square job hurry hair better tourist laptop drama long nest bomb blast surround recycle gas lounge hybrid",
        "conduct beyond strong garage nose three mammal slim spread leaf health digital trigger original crawl pilot fat attract suffer toilet float drum age print",
        "portion upgrade frequent borrow quantum govern rice swing merge light inflict primary cruise spike kiss robot city exhibit knife blade flip face vote coach"
    ]

    const payload = getSendCommissionPayload()
    const order = getOrderByPayload(payload)

    for (let i = 0; i < 3; i++) {
        const ownerKeys = await mnemonicToPrivateKey(mnemonic[i].split(" "))
        order.sign(i, ownerKeys.secretKey)
    }

    await admin.sendOrder(order, (await mnemonicToPrivateKey(mnemonic[0].split(" "))).secretKey, 0);

    console.log(await admin.getTempConfig())
}
