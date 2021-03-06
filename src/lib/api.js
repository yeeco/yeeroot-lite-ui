import conf from '@/config'
import axios from 'axios'
import {
    calls, runtime, chain, system, runtimeUp, pretty,
    addressBook, secretStore, metadata, nodeService, bytesToHex, hexToBytes, AccountId
} from 'oo7-substrate';
import {sign, verify} from '@polkadot/wasm-schnorrkel';
import bech32 from 'bech32';

const api = {
    id: 0,
    hrp: "yee",
    request(method, path, params) {
        let url = conf.apiBase + path
        params = params || {}

        if (method === 'get') {
            return new Promise((resolve, reject) => {
                axios.get(url, {
                    params: params
                }).then(
                    res => {
                        if (res.data.error
                        ) {
                            reject(res)
                        } else {
                            resolve(res)
                        }
                    },
                    res => {
                        reject(res)
                    }
                )
            })
        } else if (method === 'post') {
            return new Promise((resolve, reject) => {
                let data = null
                if (params.body) {
                    data = params.body
                } else {
                    // data = $.param(params)
                    data = params
                }
                axios.post(url, data, {
                    headers: {
                        "Access-Control-Allow-Origin": "*"
                    }
                }).then(
                    res => {
                        if (res.data.error) {
                            reject(res)
                        } else {
                            resolve(res)
                        }
                    },
                    res => {
                        reject(res)
                    }
                )
            })
        }
    },
    rpcCall(method, params) {
        return api.request('post', '/', {'jsonrpc': '2.0', 'id': api.id++, 'method': method, 'params': params})
    },
    utils: {
        isIntNum(val) {
            var regPos = /^\d+$/; // 非负整数
            if (regPos.test(val)) {
                return true;
            } else {
                return false;
            }
        }
        ,
        getDisplayHash(hash) {
            return hash.substr(0, 6) + '...' + hash.substr(hash.length - 6, hash.length)
        },
        getRecentBlocks(shardNum) {
            return new Promise((resolve, reject) => {
                api.rpcCall('chain_getHeader', [shardNum, null]).then(
                    (res) => {
                        let number = eval(res.data.result.number)
                        //console.log(number)

                        let ps = [
                            api.rpcCall('chain_getBlockHash', [shardNum, number]),
                            api.rpcCall('chain_getBlockHash', [shardNum, number - 1]),
                            api.rpcCall('chain_getBlockHash', [shardNum, number - 2]),
                        ]

                        Promise.all(ps).then(
                            (res) => {
                                console.log(res)
                                let ret = []
                                ret[0] = {number: number, hash: res[0].data.result}
                                ret[1] = {number: number - 1, hash: res[1].data.result}
                                ret[2] = {number: number - 2, hash: res[2].data.result}

                                let ps = [
                                    api.rpcCall('chain_getHeader', [shardNum, ret[0].hash]),
                                    api.rpcCall('chain_getHeader', [shardNum, ret[1].hash]),
                                    api.rpcCall('chain_getHeader', [shardNum, ret[2].hash]),
                                ]

                                Promise.all(ps).then(
                                    (res2) => {
                                        console.log(res2)
                                        let ret2 = []
                                        ret2[0] = {
                                            number: number,
                                            hash: ret[0].hash,
                                            digest: res2[0].data.result.digest
                                        }
                                        ret2[1] = {
                                            number: number - 1,
                                            hash: ret[1].hash,
                                            digest: res2[1].data.result.digest
                                        }
                                        ret2[2] = {
                                            number: number - 2,
                                            hash: ret[2].hash,
                                            digest: res2[2].data.result.digest
                                        }

                                        resolve(ret2)
                                    }
                                ).catch(
                                    (res) => {
                                        reject(res)
                                    }
                                )
                            }
                        ).catch(
                            (res) => {
                                reject(res)
                            }
                        )
                    }
                ).catch(
                    (res) => {
                        reject(res)
                    }
                )
            })
        },
        generateSrKeyPair() {
            let mnemonic = secretStore().generateMnemonic()
            // let seed = srKeypairFromUri("//Alice")
            let seed = srKeypairFromUri(mnemonic)
            return seed
        },
        srKeypairToPublic(pair) {
            return new Uint8Array(pair.slice(64, 96))
        },
        srKeypairToSecret(pair) {
            return new Uint8Array(pair.slice(0, 64))
        },
        bech32Encode(bytes) {
            return bech32.encode(api.hrp, bech32.toWords(bytes))
        },
        bech32Decode(str) {
            return new Uint8Array(bech32.fromWords(bech32.decode(str).words))
        },
        getShardNum(addressPublic) {
            let last = addressPublic[31]
            let mask = 0x03
            let shardNum = mask & last
            return shardNum
        },
        runInBalancesTransferCall(dest, value, calls, cb) {
            let callBond = calls.balances.transfer(dest, value);
            callBond.tie((call, i) => {
                console.log('call: ', call);
                cb(call);
                callBond.untie();
            })
        },
        runInIssueAssetCall(name, supply, decimals, calls, cb) {
            let callBond = calls.assets.issue(name, supply, decimals);
            callBond.tie((call, i) => {
                console.log('call: ', call);
                cb(call);
                callBond.untie();
            })
        },
        runInAssetTransferCall(shard_code, id, dest, value, calls, cb) {
            let callBond = calls.assets.transfer(shard_code, id, dest, value);
            callBond.tie((call, i) => {
                console.log('call: ', call);
                cb(call);
                callBond.untie();
            })
        },
        runInStorageTransferCall(data, calls, cb) {
            let callBond = calls.storage.store(data);
            callBond.tie((call, i) => {
                console.log('storage-call: ', call);
                cb(call);
                callBond.untie();
            });
        },
        composeTransaction(senderPublic, secret, call) {

            return new Promise((resolve, reject) => {

                let shardNum = api.utils.getShardNum(senderPublic)
                console.log('shardNum:', shardNum)

                api.rpcCall('chain_getHeader', [shardNum, null]).then((res) => {

                    let height = eval(res.data.result.number)
                    console.log('height: ', height)

                    //
                    let longevity = 64
                    let l = Math.min(15, Math.max(1, Math.ceil(Math.log2(longevity)) - 1))
                    let period = 2 << l
                    let factor = Math.max(1, period >> 12)
                    let Q = (n, d) => Math.floor(n / d) * d
                    let eraNumber = Q(height, factor)
                    let phase = eraNumber % period
                    let era = new TransactionEra(period, phase)
                    //

                    api.rpcCall('chain_getHead', [shardNum, eraNumber]).then((res) => {
                        let eraHash = hexToBytes(res.data.result)

                        console.log('eraHash: ', res.data.result, eraHash)

                        api.rpcCall('state_getNonce', [api.utils.bech32Encode(senderPublic)]).then((res) => {
                            let index = eval(res.data.result)
                            console.log('index: ', index)

                            let e = encode([
                                index, call, era, eraHash
                            ], [
                                'Compact<Index>', 'Call', 'TransactionEra', 'Hash'
                            ])

                            console.log('e: ', e)

                            let signature = sign(senderPublic, secret, e)
                            if (!verify(signature, e, senderPublic)) {
                                console.warn(`Signature is INVALID!`)
                                reject('sign error')
                                return
                            }
                            console.log('signature: ', signature)

                            // let senderAccountId = new AccountId(senderPublic)
                            // console.log('senderAccountId: ', senderAccountId)

                            let signedData = encode(encode({
                                _type: 'Transaction',
                                version: 0x81,
                                sender: senderPublic,
                                signature,
                                index,
                                era,
                                call
                            }), 'Vec<u8>')
                            let extrinsic = '0x' + bytesToHex(signedData)
                            console.log("extrinsic:", extrinsic)

                            api.rpcCall('author_submitExtrinsic', [extrinsic]).then(
                                (res) => {
                                    console.log("res:", res)
                                    resolve(res)
                                }
                            ).catch((res) => {
                                console.log("err:", res)
                                reject(res)
                            })

                        }).catch((res) => {
                            reject(res)
                        })

                    }).catch((res) => {
                        reject(res)
                    })


                }).catch((res) => {
                    reject(res)
                })

            })

        },
        compactLen(num) {
            if (num <= 0b00111111) {
                return 1;
            } else if (num <= 0b0011111111111111) {
                return 2;
            } else if (num <= 0b00111111111111111111111111111111) {
                return 4;
            }
            return 5;
        },
        decodePowSeal(input) {
            input = input.replace('0x', '')
            let digestItemType = decode(hexToBytes(input.substr(0, 2)), 'u16');
            if (digestItemType != 4) {//consensus
                return null;
            }

            let vecLen = decode(hexToBytes(input.substr(2 + 8, 10)), 'Compact<u32>');
            let compactLen = api.utils.compactLen(vecLen);

            let authority_id = decode(hexToBytes(input.substr(2 + 8 + compactLen * 2, 64)), 'AccountId');

            let pow_target = decode(hexToBytes(input.substr(2 + 8 + compactLen * 2 + 64, 64)), 'Hash').reverse();

            let timestamp = decode(hexToBytes(input.substr(2 + 8 + compactLen * 2 + 64 + 64, 16)), 'u64');

            let workProofType = decode(hexToBytes(input.substr(2 + 8 + compactLen * 2 + 64 + 64 + 16, 2)), 'u16');

            let workProof = {};

            let workProofOffset = 2 + 8 + compactLen * 2 + 64 + 64 + 16 + 2;

            if (workProofType == 1) {
                //do nothing

            } else if (workProofType == 2) {
                let extraDataLen = 80;
                // compactLen = api.utils.compactLen(extraDataLen);

                let merkleRoot = input.substr(workProofOffset + extraDataLen, 64);

                workProof = {
                    extraDataLen,
                    merkleRoot,
                }
            }

            return {
                digestItemType,
                vecLen,
                authority_id,
                pow_target,
                timestamp,
                workProofType,
                workProof,
            }
        },
        decodeFinalityTracker(input) {
            input = input.replace('0x', '')
            let digestItemType = decode(hexToBytes(input.substr(0, 2)), 'u16')
            if (digestItemType != 0) {//log
                return null
            }

            let vecLen = decode(hexToBytes(input.substr(2, 10)), 'Compact<u32>')
            let compactLen = api.utils.compactLen(vecLen)

            let module = decode(hexToBytes(input.substr(2 + compactLen * 2, 2)), 'u8');

            if (module != 4) {//finality tracker module
                return null
            }

            let log = decode(hexToBytes(input.substr(2 + compactLen * 2 + 2, 2)), 'u8');

            if (log != 0) {//FinalizedBlockNumber
                return null
            }

            let finalizedBlockNumber = decode(hexToBytes(input.substr(2 + compactLen * 2 + 2 + 2, 16)), 'u64');

            return {
                finalizedBlockNumber: finalizedBlockNumber,
            }
        }

    }
}

export default api
