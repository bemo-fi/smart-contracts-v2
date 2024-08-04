import { NetworkProvider} from "@ton/blueprint";
import {mnemonicToPrivateKey} from "ton-crypto";
import {TransactionMultisig} from "../wrappers/TransactionMultisig";
import {Address} from "@ton/core";
import {getOrderByPayload} from "../wrappers/utils/MultisigOrder";
import {getSendTonFromFinancialPayload} from "../wrappers/utils/TransactionMultisigUtils";

export async function run(provider: NetworkProvider) {
    const mnemonic = [
        "few escape silent judge hard method powder woman olympic absurd stereo smooth swing flame weather total canvas type patch eternal joy river artwork wise",
        "possible load ignore become coffee wagon pass knee kingdom disease uniform misery strike use cook describe member trend case umbrella soccer museum lazy throw",
        "page similar announce unique mobile document bounce senior enact fiber congress portion flame disorder walk nothing tower mixture neck enact purpose bubble nature any"
    ]

    const payload = getSendTonFromFinancialPayload(
        "EQCEuIGH8I2bkAf8rLpuxkWmDJ_xZedEHDvjs6aCAN2FrkFp",
        40,
        40,
        9,
        10,
        20)

    const order = getOrderByPayload(payload)

    for (let i = 0; i < 3; i++) {
        const ownerKeys = await mnemonicToPrivateKey(mnemonic[i].split(" "))
        order.sign(i, ownerKeys.secretKey)
    }

    const transactionMultisig = provider.open(TransactionMultisig.createFromAddress(Address.parse("EQBpD7mQDcTWg2xdGWB_RttKJeDxawV4XS_K50F8mnL-Uzet")));

    await transactionMultisig.sendOrder(order, (await mnemonicToPrivateKey(mnemonic[0].split(" "))).secretKey, 0)

    // run methods on `transactionMultisig`

    // const tr = provider.open(TransactionMultisig.createFromAddress(Address.parse("EQBe_8UH8ohXwb8cEHk-gCt0x_ZRYTLaprs56s2p5ziFcP84")))
    // console.log(await tr.getPoolAndProxyAddresses("EQCEuIGH8I2bkAf8rLpuxkWmDJ_xZedEHDvjs6aCAN2FrkFp", 40, 40, 10, 10))

}
