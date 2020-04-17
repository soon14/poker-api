const CryptoJS = require('crypto-js')
const { encryptionSalt } = require('../config')
const { PREFLOP, phases } = require('../constants')

const decryptHand = hand => [
    CryptoJS.AES.decrypt(hand[0], encryptionSalt).toString(CryptoJS.enc.Utf8),
    CryptoJS.AES.decrypt(hand[1], encryptionSalt).toString(CryptoJS.enc.Utf8)
]

const getLargestBet = game => Math.max(...game.bets.map(bet => bet.amount))

const updateAllUsers = game => {
    game = game.toObject()
    const playersWithoutHands = game.players.map(player => ({ ...player, hand: undefined }))
    const connectedSockets = Object.keys(io.in(game._id).sockets)

    connectedSockets.forEach(socketId => {
        const player = game.players.find(player => player.socketId === socketId)

        let hand
        if (player) {
            hand = decryptHand(player.hand)
        }

        io.to(socketId).emit('gameUpdate', { ...game, players: playersWithoutHands, hand })
    })
}

const finishTurn = game => {
    const currentPlayerIndex = game.players.findIndex(p => p.isTurn)
    const currentPlayer = game.players[currentPlayerIndex]

    const largestBet = getLargestBet(game)

    const currentBetIndex = game.bets.findIndex(bet => bet.playerId.equals(currentPlayer._id))
    const currentBet = game.bets[currentBetIndex].amount

    if (game.phase === PREFLOP && currentPlayer.isBigBlind && currentBet === largestBet) {
        game = incrementPhase(game)
    } else {
        const allPlayersHaveLargestBet = [...new Set(game.bets.map(bet => bet.amount))].length === 1

        const allPlayerHaveActedThatHaveHands = !game.players.find(p => p.hand && !p.hasActed)
        if (allPlayersHaveLargestBet && (game.lastToRaiseId || allPlayerHaveActedThatHaveHands)) {
            game = incrementPhase(game)
        } else {
            game = incrementTurn(game)
        }
    }

    return game
}

const incrementTurn = game => {
    const currentPlayerIndex = game.players.findIndex(p => p.isTurn)
    let nextPlayerIndex = (currentPlayerIndex + 1) % game.players.length

    // Players that have folded will not have a hand and should be skipped.
    while (!game.players[nextPlayerIndex].hand) {
        nextPlayerIndex = (nextPlayerIndex + 1) % game.players.length
    }

    game.players.set(currentPlayerIndex, { ...game.players[currentPlayerIndex], isTurn: false })
    game.players.set(nextPlayerIndex, { ...game.players[nextPlayerIndex], isTurn: true })

    return game
}

// TODO: consider refactoring and combine shared code from incrementTurn
const incrementPhase = game => {
    const currentPhaseIndex = phases.findIndex(phase => phase === game.phase)
    const nextPhaseIndex = (currentPhaseIndex + 1) % phases.length

    game.phase = phases[nextPhaseIndex]
    game.lastToRaiseId = undefined

    const dealerIndex = game.players.findIndex(p => p.isDealer)

    // Dealer is last to act.
    let firstToActIndex = (dealerIndex + 1) % game.players.length

    // If dealer has folded, continue to search for the next player who hasn't folded.
    while (!game.players[firstToActIndex].hand) {
        firstToActIndex = (firstToActIndex + 1) % game.players.length
    }

    const currentPlayerIndex = game.players.findIndex(p => p.isTurn)
    game.players.set(currentPlayerIndex, { ...game.players[currentPlayerIndex], isTurn: false, hasActed: false })
    game.players.set(firstToActIndex, { ...game.players[firstToActIndex], isTurn: true, hasActed: false })

    // TODO: add tests for this
    game.players.forEach((player, i) => {
        if (player.hand && ![currentPlayerIndex, firstToActIndex].includes(i)) {
            game.players.set(i, { ...game.players[i], hasActed: false })
        }
    })

    return game
}

module.exports = {
    decryptHand,
    getLargestBet,
    updateAllUsers,
    finishTurn,
    incrementPhase,
    incrementTurn
}