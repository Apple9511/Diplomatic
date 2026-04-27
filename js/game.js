// game.js
class Game {
    constructor() {
        console.log('Game constructor called');
        this.currentPlayer = null;
        this.currentPlayerId = null;
        this.gameInterval = null;
        this.tradeListeners = [];
        this.gameActive = true;
        this.winnerDeclared = false;
        
        if (typeof database !== 'undefined' && database) {
            this.initializeGame();
        } else {
            console.error("Database not initialized");
            setTimeout(() => {
                if (typeof database !== 'undefined' && database) {
                    this.initializeGame();
                } else {
                    console.error("Database still not available");
                }
            }, 1000);
        }
    }

    async initializeGame() {
        console.log('Initializing game...');
        this.setupListeners();
        this.startDailyTimer();
        this.checkExistingSession();
        this.setupTradeListeners();
        this.startTradeCleanup();
        this.setupResizeHandler();
        this.setupGameOverListener();
    }

    setupGameOverListener() {
        if (!countriesRef) return;
        
        countriesRef.on('child_removed', async (snapshot) => {
            if (snapshot.key === this.currentPlayerId) {
                await this.handleDefeat('Your country has been destroyed!');
            }
        });
        
        countriesRef.on('child_changed', async (snapshot) => {
            if (snapshot.key === this.currentPlayerId && this.gameActive) {
                const country = snapshot.val();
                if (country && country.lives <= 0) {
                    await this.handleDefeat('Your country has been conquered!');
                }
            }
        });
    }

    setupListeners() {
        if (!database) {
            console.error('Database not available for listeners');
            return;
        }
        
        gameStateRef.on('value', (snapshot) => {
            const gameState = snapshot.val();
            if (gameState) {
                this.updateGameTime(gameState);
            }
        });

        countriesRef.on('child_changed', (snapshot) => {
            const updatedCountry = snapshot.val();
            if (snapshot.key === this.currentPlayerId && this.gameActive) {
                this.updatePlayerUI(updatedCountry);
                if (updatedCountry.lives <= 0) {
                    this.handleDefeat('Your country has been destroyed!');
                }
            }
            this.updateNeighborSelectors();
            this.updateMap();
            this.checkWinCondition();
        });

        countriesRef.on('child_added', () => {
            this.updateNeighborSelectors();
            this.updateMap();
            this.checkWinCondition();
        });

        countriesRef.on('child_removed', () => {
            this.updateNeighborSelectors();
            this.updateMap();
            this.checkWinCondition();
        });
    }

    setupTradeListeners() {
        if (!database || !tradesRef) {
            console.error('Database not available for trade listeners');
            return;
        }
        
        tradesRef.on('child_added', (snapshot) => {
            if (!this.currentPlayerId || !this.gameActive) return;
            const trade = snapshot.val();
            if (trade.toId === this.currentPlayerId && trade.status === 'pending') {
                this.showTradeNotification(trade);
            }
            if (trade.fromId === this.currentPlayerId || trade.toId === this.currentPlayerId) {
                this.updateMyTrades();
            }
        });

        tradesRef.on('child_changed', (snapshot) => {
            if (!this.currentPlayerId || !this.gameActive) return;
            const trade = snapshot.val();
            if (trade.toId === this.currentPlayerId || trade.fromId === this.currentPlayerId) {
                this.handleTradeUpdate(trade);
                this.updateMyTrades();
            }
        });

        tradesRef.on('child_removed', (snapshot) => {
            if (!this.currentPlayerId || !this.gameActive) return;
            this.updateMyTrades();
        });
    }

    async createCountry(countryData) {
        try {
            const newCountryRef = countriesRef.push();
            const countryId = newCountryRef.key;
            
            const now = Date.now();
            const country = {
                id: countryId,
                name: countryData.name,
                type: countryData.type,
                lives: GAME_CONFIG.STARTING_LIVES,
                gold: 0,
                soldiers: 0,
                actions: GAME_CONFIG.BASE_ACTIONS_PER_DAY,
                level: 1,
                upgradePoints: 0,
                neighbors: [],
                ownerId: countryId,
                isAlive: true,
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                lastDailyUpdate: firebase.database.ServerValue.TIMESTAMP,
                lastDailyReset: now,
                lastResetDay: new Date(now).getDate()
            };

            await newCountryRef.set(country);
            
            this.currentPlayerId = countryId;
            this.currentPlayer = country;
            this.gameActive = true;
            localStorage.setItem('playerId', countryId);
            
            document.getElementById('creationModal').classList.add('hidden');
            document.getElementById('playerDashboard').classList.remove('hidden');
            
            this.hideGameOverScreen();
            await this.updateNeighbors(countryId);
            await this.updateNeighborSelectors();
            
            return countryId;
        } catch (error) {
            console.error('Error creating country:', error);
            alert('Failed to create country. Please try again.');
        }
    }

    async updateNeighbors(newCountryId) {
        const snapshot = await countriesRef.once('value');
        const countries = snapshot.val();
        const countryIds = Object.keys(countries || {});
        
        if (countryIds.length > 1) {
            const otherCountries = countryIds.filter(id => id !== newCountryId);
            const aliveCountries = otherCountries.filter(id => countries[id] && countries[id].isAlive !== false);
            const neighbors = aliveCountries.slice(0, Math.min(3, aliveCountries.length));
            
            await countriesRef.child(newCountryId).child('neighbors').set(neighbors);
            
            for (const countryId of otherCountries) {
                const country = countries[countryId];
                if (!country || country.isAlive === false) continue;
                
                const countryNeighbors = (country.neighbors || []);
                if (!countryNeighbors.includes(newCountryId) && countryNeighbors.length < 3) {
                    countryNeighbors.push(newCountryId);
                    await countriesRef.child(countryId).child('neighbors').set(countryNeighbors);
                }
            }
        }
    }

    startDailyTimer() {
        // Check for missed resets every minute
        this.dailyCheckInterval = setInterval(async () => {
            await this.checkAllPlayersForDailyReset();
        }, 60000); // Check every minute
        
        // Update countdown display every second
        setInterval(() => this.updateCountdown(), 1000);
        
        // Initial check on startup
        setTimeout(() => {
            this.checkAllPlayersForDailyReset();
        }, 5000);
    }

    async checkAllPlayersForDailyReset() {
        try {
            const snapshot = await countriesRef.once('value');
            const countries = snapshot.val();
            
            if (!countries) return;
            
            const now = new Date();
            const currentDay = now.getDate();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();
            
            let anyUpdates = false;
            
            for (const [id, country] of Object.entries(countries)) {
                if (country.isAlive === false) continue;
                
                const lastResetDay = country.lastResetDay;
                const lastResetDate = country.lastDailyReset || 0;
                const lastReset = new Date(lastResetDate);
                
                // Check if reset happened on a different day
                const needsReset = (
                    lastResetDay !== currentDay ||
                    lastReset.getMonth() !== currentMonth ||
                    lastReset.getFullYear() !== currentYear
                );
                
                if (needsReset) {
                    console.log(`Daily reset needed for ${country.name} - Last reset: ${lastReset.toLocaleString()}`);
                    await this.performDailyUpdate(id, country);
                    anyUpdates = true;
                }
            }
            
            if (anyUpdates && this.currentPlayerId && this.gameActive) {
                // Refresh current player's UI if they got updated
                const playerSnapshot = await countriesRef.child(this.currentPlayerId).once('value');
                const updatedPlayer = playerSnapshot.val();
                if (updatedPlayer) {
                    this.updatePlayerUI(updatedPlayer);
                }
            }
        } catch (error) {
            console.error('Error checking daily resets:', error);
        }
    }

    async performDailyUpdate(countryId, country) {
        const updates = {};
        
        let goldEarned = GAME_CONFIG.BASE_GOLD_PER_DAY;
        let actionsEarned = GAME_CONFIG.BASE_ACTIONS_PER_DAY;
        
        // Economic bonus
        if (country.type === 'economic' && country.level > 1) {
            for (let i = 2; i <= country.level; i++) {
                if (GAME_CONFIG.ECONOMIC_BONUSES[i]?.goldPerDay) {
                    goldEarned += GAME_CONFIG.ECONOMIC_BONUSES[i].goldPerDay;
                }
            }
        }
        
        // Wartime bonus for actions
        if (country.type === 'wartime' && country.level >= 2) {
            actionsEarned += 0.5;
        }
        
        const newGold = (country.gold || 0) + goldEarned;
        const newActions = (country.actions || 0) + actionsEarned;
        
        const now = Date.now();
        const nowDate = new Date(now);
        
        updates.gold = newGold;
        updates.actions = newActions;
        updates.lastDailyUpdate = firebase.database.ServerValue.TIMESTAMP;
        updates.lastDailyReset = now;
        updates.lastResetDay = nowDate.getDate();
        
        await countriesRef.child(countryId).update(updates);
        
        console.log(`Daily reset complete for ${country.name}: +${goldEarned} gold, +${actionsEarned} actions`);
        
        // Show notification to current player if this is their country
        if (countryId === this.currentPlayerId && this.gameActive) {
            this.showMessage(`🌙 Daily Reset! +${goldEarned} gold, +${actionsEarned} actions!`, 'success');
        }
    }

    async buySoldier() {
    if (!this.currentPlayerId || !this.gameActive) return;
    
    const snapshot = await countriesRef.child(this.currentPlayerId).once('value');
    const country = snapshot.val();
    
    if (!country || country.isAlive === false) {
        this.showMessage('Your country is no longer active!', 'failure');
        return;
    }
    
    let soldierCost = 2;
    
    if (country.type === 'economic') {
        soldierCost = 1 + country.level;
    }
    
    if (country.type === 'wartime' && country.level >= 3) {
        soldierCost = 1.5;
    }
    
    if (country.gold >= soldierCost) {
        const updates = {
            gold: country.gold - soldierCost,
            soldiers: (country.soldiers || 0) + 1
        };
        
        await countriesRef.child(this.currentPlayerId).update(updates);
        this.showMessage(`Soldier purchased for ${soldierCost} gold!`, 'success');
        
        // Log the action
        await this.logAction('BUY_SOLDIER', `Purchased 1 soldier for ${soldierCost} gold`, null, 'success');
    } else {
        this.showMessage(`Not enough gold! Need ${soldierCost} gold.`, 'failure');
        await this.logAction('BUY_SOLDIER', `Attempted to buy soldier but only had ${country.gold} gold`, null, 'failed - insufficient gold');
    }
}


   async fortify(targetId = null) {
    if (!this.currentPlayerId || !this.gameActive) return;
    
    const target = targetId || this.currentPlayerId;
    const snapshot = await countriesRef.child(target).once('value');
    const country = snapshot.val();
    
    if (!country || (target !== this.currentPlayerId && country.isAlive === false)) {
        this.showMessage('Target country is not active!', 'failure');
        return;
    }
    
    if (target !== this.currentPlayerId) {
        const playerSnapshot = await countriesRef.child(this.currentPlayerId).once('value');
        const player = playerSnapshot.val();
        if (!player.neighbors || !player.neighbors.includes(target)) {
            this.showMessage('You can only heal neighboring countries!', 'failure');
            await this.logAction('FORTIFY', `Attempted to heal non-neighbor ${country.name}`, target, 'failed - not neighbor');
            return;
        }
    }
    
    if (target === this.currentPlayerId) {
        const playerSnapshot = await countriesRef.child(this.currentPlayerId).once('value');
        const player = playerSnapshot.val();
        
        if (player.actions < 1) {
            this.showMessage('Not enough actions!', 'failure');
            await this.logAction('FORTIFY', 'Attempted to fortify with 0 actions', null, 'failed - no actions');
            return;
        }
        
        let goldCost = 0;
        if (player.type === 'economic' && player.level >= 4) {
            goldCost = 2;
            if (player.gold < goldCost) {
                this.showMessage(`Not enough gold! Need ${goldCost} gold to fortify.`, 'failure');
                await this.logAction('FORTIFY', `Attempted to fortify but only had ${player.gold} gold`, null, 'failed - insufficient gold');
                return;
            }
        }
        
        if (country.lives < GAME_CONFIG.MAX_LIVES) {
            const updates = {
                lives: Math.min(country.lives + 1, GAME_CONFIG.MAX_LIVES),
                actions: player.actions - 1
            };
            
            if (goldCost > 0) {
                updates.gold = player.gold - goldCost;
            }
            
            await countriesRef.child(this.currentPlayerId).update(updates);
            this.showMessage('Fortification successful! +1 Life', 'success');
            await this.logAction('FORTIFY', `Increased lives from ${country.lives} to ${country.lives + 1}`, null, 'success');
        } else {
            this.showMessage('Already at maximum lives!', 'failure');
            await this.logAction('FORTIFY', `Attempted to fortify but already at max lives (${country.lives}/${GAME_CONFIG.MAX_LIVES})`, null, 'failed - max lives');
        }
    }
}

    async attack(neighborId) {
    if (!this.currentPlayerId || !this.gameActive) return;
    
    const attackerSnapshot = await countriesRef.child(this.currentPlayerId).once('value');
    const attacker = attackerSnapshot.val();
    const defenderSnapshot = await countriesRef.child(neighborId).once('value');
    const defender = defenderSnapshot.val();
    
    if (!defender) {
        this.showMessage('Target country not found!', 'failure');
        return;
    }
    
    if (defender.isAlive === false) {
        this.showMessage('Target country is already defeated!', 'failure');
        await this.logAction('ATTACK', `Attempted to attack already defeated country ${defender.name}`, neighborId, 'failed - already defeated');
        return;
    }
    
    if (attacker.soldiers < 1) {
        this.showMessage('Need at least 1 soldier to attack!', 'failure');
        await this.logAction('ATTACK', `Attempted to attack with 0 soldiers`, neighborId, 'failed - no soldiers');
        return;
    }
    
    if (attacker.actions < 1) {
        this.showMessage('Need 1 action to attack!', 'failure');
        await this.logAction('ATTACK', `Attempted to attack with 0 actions`, neighborId, 'failed - no actions');
        return;
    }
    
    if (!attacker.neighbors || !attacker.neighbors.includes(neighborId)) {
        this.showMessage('You can only attack neighboring countries!', 'failure');
        await this.logAction('ATTACK', `Attempted to attack non-neighbor ${defender.name}`, neighborId, 'failed - not neighbor');
        return;
    }
    
    let attackSuccess = Math.random() < 0.5;
    let rerollUsed = false;
    
    if (!attackSuccess && attacker.type === 'wartime' && attacker.level >= 2) {
        if (attacker.gold >= 2) {
            if (confirm('Attack failed! Spend 2 gold to reroll?')) {
                attackSuccess = Math.random() < 0.5;
                rerollUsed = true;
                await countriesRef.child(this.currentPlayerId).child('gold').set(attacker.gold - 2);
            }
        }
    }
    
    const updates = {
        soldiers: attacker.soldiers - 1,
        actions: attacker.actions - 1
    };
    
    if (attackSuccess) {
        const defenderUpdates = {
            lives: defender.lives - 1,
            gold: Math.max(0, (defender.gold || 0) - 1)
        };
        
        if (defender.lives - 1 <= 0) {
            defenderUpdates.isAlive = false;
            defenderUpdates.lives = 0;
            
            this.showMessage(`You defeated ${defender.name}!`, 'success');
            
            updates.gold = (attacker.gold || 0) + 5;
            this.showMessage(`+5 Gold reward for victory!`, 'success');
            
            await this.logAction('ATTACK', `Defeated ${defender.name} and conquered their territory${rerollUsed ? ' (used reroll)' : ''}`, neighborId, 'victory');
            
            await this.checkPlayerElimination(neighborId);
        } else {
            updates.gold = (attacker.gold || 0) + 1;
            this.showMessage('Attack successful! Stole 1 gold!', 'success');
            await this.logAction('ATTACK', `Successfully attacked ${defender.name}, stole 1 gold, dealt 1 damage${rerollUsed ? ' (used reroll)' : ''}`, neighborId, 'success');
        }
        
        await countriesRef.child(neighborId).update(defenderUpdates);
    } else {
        this.showMessage('Attack failed!', 'failure');
        await this.logAction('ATTACK', `Failed to attack ${defender.name}${rerollUsed ? ' (reroll also failed)' : ''}`, neighborId, 'failed');
    }
    
    await countriesRef.child(this.currentPlayerId).update(updates);
    await this.checkWinCondition();
}

    async checkWinCondition() {
        if (this.winnerDeclared) return;
        
        const snapshot = await countriesRef.once('value');
        const countries = snapshot.val();
        
        if (!countries) return;
        
        const aliveCountries = Object.entries(countries).filter(([id, country]) => 
            country.isAlive !== false
        );
        
        const totalCountriesEver = Object.keys(countries).length;
        if (totalCountriesEver < 2) {
            return;
        }
        
        const uniqueOwners = new Set();
        aliveCountries.forEach(([id, country]) => {
            uniqueOwners.add(country.ownerId || id);
        });
        
        if (uniqueOwners.size === 1 && aliveCountries.length > 0 && totalCountriesEver >= 2) {
            if (aliveCountries.length === totalCountriesEver && totalCountriesEver === 1) {
                return;
            }
            
            const winnerId = Array.from(uniqueOwners)[0];
            const winnerCountry = aliveCountries.find(([id, country]) => 
                (country.ownerId || id) === winnerId
            )[1];
            
            this.winnerDeclared = true;
            this.gameActive = false;
            
            this.showVictory(winnerCountry.name);
        }
    }

    async handleDefeat(reason) {
        if (!this.gameActive) return;
        
        this.gameActive = false;
        this.winnerDeclared = true;
        
        if (this.currentPlayerId) {
            await countriesRef.child(this.currentPlayerId).update({
                isAlive: false,
                lives: 0
            });
        }
        
        this.showDefeatScreen(reason);
        this.disableGameControls();
    }

    showVictory(winnerName) {
        const victoryDiv = document.createElement('div');
        victoryDiv.className = 'game-overlay victory';
        victoryDiv.innerHTML = `
            <div class="game-over-content">
                <div class="victory-icon">🏆</div>
                <h1>VICTORY!</h1>
                <h2>${winnerName} has conquered the world!</h2>
                <p>All other nations have fallen before your might.</p>
                <div class="game-stats">
                    <h3>Final Statistics</h3>
                    <div id="finalStats"></div>
                </div>
                <button onclick="window.location.reload()">PLAY AGAIN</button>
                <button onclick="window.game.showMainMenu()">MAIN MENU</button>
            </div>
        `;
        
        document.body.appendChild(victoryDiv);
        this.loadFinalStats();
    }

    showDefeatScreen(reason) {
        const defeatDiv = document.createElement('div');
        defeatDiv.className = 'game-overlay defeat';
        defeatDiv.innerHTML = `
            <div class="game-over-content">
                <div class="defeat-icon">💀</div>
                <h1>DEFEAT</h1>
                <h2>${reason}</h2>
                <p>Your nation has fallen. The dream of conquest ends here.</p>
                <div class="game-stats">
                    <h3>Your Legacy</h3>
                    <div id="finalStats"></div>
                </div>
                <button onclick="window.location.reload()">PLAY AGAIN</button>
                <button onclick="window.game.showMainMenu()">MAIN MENU</button>
            </div>
        `;
        
        document.body.appendChild(defeatDiv);
        this.loadFinalStats(true);
    }

    async loadFinalStats(forPlayer = false) {
        const statsDiv = document.getElementById('finalStats');
        if (!statsDiv) return;
        
        const snapshot = await countriesRef.once('value');
        const countries = snapshot.val();
        
        if (!countries) return;
        
        if (forPlayer && this.currentPlayerId) {
            const playerCountry = countries[this.currentPlayerId];
            if (playerCountry) {
                statsDiv.innerHTML = `
                    <p>🏰 Country: ${playerCountry.name}</p>
                    <p>⭐ Type: ${playerCountry.type}</p>
                    <p>📊 Final Level: ${playerCountry.level}</p>
                    <p>💰 Gold Collected: ${playerCountry.gold?.toFixed(1) || 0}</p>
                    <p>⚔️ Soldiers Trained: ${playerCountry.soldiers || 0}</p>
                    <p>🎯 Actions Used: ${GAME_CONFIG.BASE_ACTIONS_PER_DAY - (playerCountry.actions || 0)}</p>
                `;
            }
        } else {
            const aliveCountries = Object.values(countries).filter(c => c.isAlive !== false);
            const totalCountries = Object.keys(countries).length;
            const eliminated = totalCountries - aliveCountries.length;
            
            statsDiv.innerHTML = `
                <p>🌍 Total Nations: ${totalCountries}</p>
                <p>💀 Nations Eliminated: ${eliminated}</p>
                <p>⭐ Surviving Nations: ${aliveCountries.length}</p>
                <p>🏆 Winner takes all!</p>
            `;
        }
    }

    disableGameControls() {
        const buttons = ['buySoldier', 'fortify', 'healNeighbor', 'upgrade', 'attackBtn', 'proposeTrade'];
        buttons.forEach(btnId => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            }
        });
        
        const selects = ['neighborSelect', 'tradePartner'];
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            if (select) {
                select.disabled = true;
                select.style.opacity = '0.5';
            }
        });
    }

    hideGameOverScreen() {
        const overlays = document.querySelectorAll('.game-overlay');
        overlays.forEach(overlay => overlay.remove());
    }

    showMainMenu() {
        localStorage.removeItem('playerId');
        window.location.reload();
    }

    async upgrade() {
    if (!this.currentPlayerId || !this.gameActive) return;
    
    const snapshot = await countriesRef.child(this.currentPlayerId).once('value');
    const country = snapshot.val();
    
    if (!country || country.isAlive === false) {
        this.showMessage('Your country is no longer active!', 'failure');
        return;
    }
    
    if (country.actions < 1) {
        this.showMessage('Not enough actions!', 'failure');
        await this.logAction('UPGRADE', 'Attempted to upgrade with 0 actions', null, 'failed - no actions');
        return;
    }
    
    if (country.level >= 4) {
        this.showMessage('Already at maximum level!', 'failure');
        await this.logAction('UPGRADE', `Attempted to upgrade but already at max level ${country.level}`, null, 'failed - max level');
        return;
    }
    
    const newUpgradePoints = (country.upgradePoints || 0) + 1;
    const nextLevel = country.level + 1;
    const requiredPoints = GAME_CONFIG.UPGRADE_REQUIREMENTS[nextLevel];
    
    const updates = {
        actions: country.actions - 1,
        upgradePoints: newUpgradePoints
    };
    
    let leveledUp = false;
    if (newUpgradePoints >= requiredPoints) {
        updates.level = nextLevel;
        updates.upgradePoints = newUpgradePoints - requiredPoints;
        leveledUp = true;
        this.showMessage(`Level Up! Now level ${nextLevel}!`, 'success');
    }
    
    await countriesRef.child(this.currentPlayerId).update(updates);
    
    if (leveledUp) {
        await this.logAction('UPGRADE', `Upgraded from level ${country.level} to ${nextLevel} (${newUpgradePoints}/${requiredPoints} points)`, null, 'level_up');
    } else {
        await this.logAction('UPGRADE', `Gained 1 upgrade point (${newUpgradePoints}/${requiredPoints} for next level)`, null, 'progress');
    }
}


    async proposeTrade(tradeData) {
    if (!this.currentPlayerId || !this.gameActive) {
        this.showMessage('Game is not active!', 'failure');
        return;
    }
    
    try {
        const snapshot = await countriesRef.child(this.currentPlayerId).once('value');
        const player = snapshot.val();
        
        if (!player || player.isAlive === false) {
            this.showMessage('Your country is not active!', 'failure');
            return;
        }
        
        if (player.gold < tradeData.gold) {
            this.showMessage(`You don't have ${tradeData.gold} gold!`, 'failure');
            await this.logAction('TRADE_PROPOSE', `Attempted to trade ${tradeData.gold} gold but only had ${player.gold}`, tradeData.partnerId, 'failed - insufficient gold');
            return;
        }
        
        if (player.soldiers < tradeData.soldiers) {
            this.showMessage(`You don't have ${tradeData.soldiers} soldiers!`, 'failure');
            await this.logAction('TRADE_PROPOSE', `Attempted to trade ${tradeData.soldiers} soldiers but only had ${player.soldiers}`, tradeData.partnerId, 'failed - insufficient soldiers');
            return;
        }
        
        if (tradeData.actions > 0) {
            if (!player.neighbors || !player.neighbors.includes(tradeData.partnerId)) {
                this.showMessage('Actions can only be traded with neighboring countries!', 'failure');
                await this.logAction('TRADE_PROPOSE', `Attempted to trade actions with non-neighbor`, tradeData.partnerId, 'failed - not neighbor');
                return;
            }
            
            if (player.actions < tradeData.actions) {
                this.showMessage(`You don't have ${tradeData.actions} actions!`, 'failure');
                await this.logAction('TRADE_PROPOSE', `Attempted to trade ${tradeData.actions} actions but only had ${player.actions}`, tradeData.partnerId, 'failed - insufficient actions');
                return;
            }
        }
        
        const tradeRef = tradesRef.push();
        const trade = {
            id: tradeRef.key,
            fromId: this.currentPlayerId,
            fromName: player.name,
            toId: tradeData.partnerId,
            gold: parseInt(tradeData.gold) || 0,
            soldiers: parseInt(tradeData.soldiers) || 0,
            actions: parseInt(tradeData.actions) || 0,
            status: 'pending',
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            expiresAt: Date.now() + (24 * 60 * 60 * 1000)
        };
        
        const updates = {
            gold: player.gold - trade.gold,
            soldiers: player.soldiers - trade.soldiers
        };
        
        if (trade.actions > 0) {
            updates.actions = player.actions - trade.actions;
        }
        
        await countriesRef.child(this.currentPlayerId).update(updates);
        await tradeRef.set(trade);
        
        this.showMessage(`Trade proposal sent!`, 'success');
        await this.logAction('TRADE_PROPOSE', `Proposed trade: ${trade.gold} gold, ${trade.soldiers} soldiers, ${trade.actions} actions`, tradeData.partnerId, 'sent');
        
        document.getElementById('tradeGold').value = '';
        document.getElementById('tradeSoldiers').value = '';
        document.getElementById('tradeActions').value = '';
        
    } catch (error) {
        console.error('Error proposing trade:', error);
        this.showMessage('Failed to propose trade', 'failure');
    }
}

    async rejectTrade(tradeId) {
        if (!this.gameActive) return;
        
        try {
            const tradeSnapshot = await tradesRef.child(tradeId).once('value');
            const trade = tradeSnapshot.val();
            
            if (!trade || trade.status !== 'pending') return;
            
            const senderSnapshot = await countriesRef.child(trade.fromId).once('value');
            const sender = senderSnapshot.val();
            
            if (!sender) return;
            
            const senderUpdates = {
                gold: (sender.gold || 0) + trade.gold,
                soldiers: (sender.soldiers || 0) + trade.soldiers
            };
            
            if (trade.actions > 0) {
                senderUpdates.actions = (sender.actions || 0) + trade.actions;
            }
            
            await tradesRef.child(tradeId).update({ 
                status: 'rejected',
                rejectedAt: firebase.database.ServerValue.TIMESTAMP
            });
            
            await countriesRef.child(trade.fromId).update(senderUpdates);
            
            this.showMessage('Trade rejected', 'info');
            this.removeTradeNotification(tradeId);
            
        } catch (error) {
            console.error('Error rejecting trade:', error);
            this.showMessage('Failed to reject trade', 'failure');
        }
    }

    async cancelTrade(tradeId) {
        if (!this.gameActive) return;
        
        try {
            const tradeSnapshot = await tradesRef.child(tradeId).once('value');
            const trade = tradeSnapshot.val();
            
            if (!trade || trade.status !== 'pending') return;
            if (trade.fromId !== this.currentPlayerId) return;
            
            const senderSnapshot = await countriesRef.child(this.currentPlayerId).once('value');
            const sender = senderSnapshot.val();
            
            if (!sender) return;
            
            const senderUpdates = {
                gold: (sender.gold || 0) + trade.gold,
                soldiers: (sender.soldiers || 0) + trade.soldiers
            };
            
            if (trade.actions > 0) {
                senderUpdates.actions = (sender.actions || 0) + trade.actions;
            }
            
            await tradesRef.child(tradeId).update({ 
                status: 'cancelled',
                cancelledAt: firebase.database.ServerValue.TIMESTAMP
            });
            
            await countriesRef.child(this.currentPlayerId).update(senderUpdates);
            
            this.showMessage('Trade cancelled', 'info');
            this.updateMyTrades();
            
        } catch (error) {
            console.error('Error cancelling trade:', error);
            this.showMessage('Failed to cancel trade', 'failure');
        }
    }

    async showTradeNotification(trade) {
        const senderSnapshot = await countriesRef.child(trade.fromId).once('value');
        const sender = senderSnapshot.val();
        
        const notificationsDiv = document.getElementById('tradeNotifications');
        const proposalsList = document.getElementById('tradeProposalsList');
        
        if (!notificationsDiv || !proposalsList) return;
        
        notificationsDiv.classList.remove('hidden');
        
        const notificationEl = document.createElement('div');
        notificationEl.className = 'trade-proposal';
        notificationEl.id = `trade-${trade.id}`;
        
        const timeUntilExpiry = Math.max(0, trade.expiresAt - Date.now());
        const hoursUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60 * 60));
        
        notificationEl.innerHTML = `
            <div class="trade-proposal-info">
                <strong>📨 Trade from ${sender?.name || 'Unknown'}</strong>
                <p>💰 Gold: ${trade.gold} | ⚔️ Soldiers: ${trade.soldiers} | 🎯 Actions: ${trade.actions}</p>
                <div class="trade-timer">⏰ Expires in ${hoursUntilExpiry} hours</div>
            </div>
            <div class="trade-proposal-actions">
                <button class="accept-trade-btn" onclick="window.game.acceptTrade('${trade.id}')">✓ Accept</button>
                <button class="reject-trade-btn" onclick="window.game.rejectTrade('${trade.id}')">✗ Reject</button>
            </div>
        `;
        
        proposalsList.appendChild(notificationEl);
    }

    removeTradeNotification(tradeId) {
        const notification = document.getElementById(`trade-${tradeId}`);
        if (notification) {
            notification.remove();
        }
        
        const proposalsList = document.getElementById('tradeProposalsList');
        const notificationsDiv = document.getElementById('tradeNotifications');
        
        if (proposalsList && proposalsList.children.length === 0) {
            notificationsDiv.classList.add('hidden');
        }
    }

    async handleTradeUpdate(trade) {
        switch(trade.status) {
            case 'accepted':
                if (trade.toId === this.currentPlayerId) {
                    this.showMessage(`✅ Trade accepted! You received resources`, 'success');
                    this.removeTradeNotification(trade.id);
                } else if (trade.fromId === this.currentPlayerId) {
                    this.showMessage(`✅ Your trade was accepted!`, 'success');
                }
                break;
                
            case 'rejected':
                if (trade.fromId === this.currentPlayerId) {
                    this.showMessage(`❌ Your trade was rejected. Resources returned.`, 'info');
                }
                this.removeTradeNotification(trade.id);
                break;
                
            case 'cancelled':
                if (trade.toId === this.currentPlayerId) {
                    this.showMessage(`ℹ️ Trade was cancelled by sender`, 'info');
                    this.removeTradeNotification(trade.id);
                }
                break;
        }
        
        this.updateMyTrades();
    }

    async updateMyTrades() {
        const myTradesDiv = document.getElementById('myPendingTrades');
        const myOffersDiv = document.getElementById('myTradeOffers');
        
        if (!myTradesDiv || !myOffersDiv) return;
        
        const snapshot = await tradesRef.once('value');
        const trades = snapshot.val();
        
        if (!trades) {
            myOffersDiv.classList.add('hidden');
            return;
        }
        
        const myPendingTrades = Object.values(trades).filter(
            trade => trade.fromId === this.currentPlayerId && trade.status === 'pending'
        );
        
        if (myPendingTrades.length > 0) {
            myOffersDiv.classList.remove('hidden');
            
            myTradesDiv.innerHTML = myPendingTrades.map(trade => {
                const timeUntilExpiry = Math.max(0, trade.expiresAt - Date.now());
                const hoursUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60 * 60));
                
                return `
                    <div class="my-trade-offer" id="my-trade-${trade.id}">
                        <div>
                            <strong>To: ${trade.toId}</strong>
                            <p>💰 ${trade.gold} | ⚔️ ${trade.soldiers} | 🎯 ${trade.actions}</p>
                            <span class="pending-badge">Pending</span>
                            <div class="trade-timer">⏰ ${hoursUntilExpiry}h remaining</div>
                        </div>
                        <button class="cancel-trade-btn" onclick="window.game.cancelTrade('${trade.id}')">Cancel</button>
                    </div>
                `;
            }).join('');
        } else {
            myOffersDiv.classList.add('hidden');
        }
    }

    startTradeCleanup() {
        setInterval(async () => {
            const snapshot = await tradesRef.once('value');
            const trades = snapshot.val();
            
            if (!trades) return;
            
            const now = Date.now();
            
            for (const [id, trade] of Object.entries(trades)) {
                if (trade.status === 'pending' && trade.expiresAt < now) {
                    const senderSnapshot = await countriesRef.child(trade.fromId).once('value');
                    const sender = senderSnapshot.val();
                    
                    if (sender) {
                        const senderUpdates = {
                            gold: (sender.gold || 0) + trade.gold,
                            soldiers: (sender.soldiers || 0) + trade.soldiers
                        };
                        
                        if (trade.actions > 0) {
                            senderUpdates.actions = (sender.actions || 0) + trade.actions;
                        }
                        
                        await countriesRef.child(trade.fromId).update(senderUpdates);
                    }
                    
                    await tradesRef.child(id).update({ status: 'expired' });
                    this.removeTradeNotification(id);
                }
            }
        }, 60000);
    }

    checkExistingSession() {
        const savedPlayerId = localStorage.getItem('playerId');
        if (savedPlayerId) {
            countriesRef.child(savedPlayerId).once('value', async (snapshot) => {
                if (snapshot.exists()) {
                    const country = snapshot.val();
                    if (country.isAlive !== false) {
                        this.currentPlayerId = savedPlayerId;
                        this.currentPlayer = country;
                        this.gameActive = true;
                        document.getElementById('creationModal').classList.add('hidden');
                        document.getElementById('playerDashboard').classList.remove('hidden');
                        this.updatePlayerUI(this.currentPlayer);
                        this.updateNeighborSelectors();
                    } else {
                        localStorage.removeItem('playerId');
                        this.showDefeatScreen('Your previous country was defeated. Start a new game!');
                    }
                } else {
                    localStorage.removeItem('playerId');
                }
            });
        }
    }

    updatePlayerUI(country) {
        document.getElementById('displayCountryName').textContent = country.name;
        document.getElementById('countryType').textContent = country.type;
        document.getElementById('lives').textContent = country.lives;
        document.getElementById('gold').textContent = country.gold?.toFixed(1) || '0';
        document.getElementById('soldiers').textContent = country.soldiers || '0';
        document.getElementById('actions').textContent = country.actions || '0';
        document.getElementById('level').textContent = country.level;
        document.getElementById('upgradePoints').textContent = country.upgradePoints || '0';
    }

    updateCountdown() {
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        
        const timeLeft = midnight - now;
        
        if (timeLeft > 0) {
            const hours = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
            
            const timerElement = document.getElementById('gameTimer');
            if (timerElement) {
                timerElement.textContent = 
                    `Next Daily Reset: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
        }
    }

    async updateMap() {
        const snapshot = await countriesRef.once('value');
        const countries = snapshot.val();
        const mapContainer = document.getElementById('mapContainer');
        
        if (!mapContainer || !countries) return;
        
        const existingCountries = mapContainer.querySelectorAll('.map-country');
        existingCountries.forEach(el => el.remove());
        
        const existingLines = mapContainer.querySelectorAll('.connection-line');
        existingLines.forEach(el => el.remove());
        
        const countryEntries = Object.entries(countries).filter(([id, country]) => country.isAlive !== false);
        const totalSectors = countryEntries.length;
        
        let controlledSectors = 0;
        if (this.currentPlayerId) {
            controlledSectors = countryEntries.filter(([id]) => 
                id === this.currentPlayerId || 
                (countries[id].neighbors && countries[id].neighbors.includes(this.currentPlayerId))
            ).length;
        }
        
        const activeConflicts = Object.values(countries).filter(c => c.isAlive !== false && c.lives <= 1).length;
        
        let tradeRoutes = 0;
        try {
            const tradesSnapshot = await tradesRef.once('value');
            const trades = tradesSnapshot.val();
            tradeRoutes = trades ? Object.values(trades).filter(t => t.status === 'pending').length : 0;
        } catch (e) {
            console.log('No trades yet');
        }
        
        const controlledEl = document.getElementById('controlledSectors');
        const totalEl = document.getElementById('totalSectors');
        const conflictsEl = document.getElementById('activeConflicts');
        const routesEl = document.getElementById('tradeRoutes');
        
        if (controlledEl) controlledEl.textContent = controlledSectors;
        if (totalEl) totalEl.textContent = totalSectors;
        if (conflictsEl) conflictsEl.textContent = activeConflicts;
        if (routesEl) routesEl.textContent = tradeRoutes;
        
        const centerX = 50;
        const centerY = 50;
        const radius = 35;
        
        countryEntries.forEach(([id, country], index) => {
            const countryDiv = document.createElement('div');
            countryDiv.className = `map-country ${country.type}`;
            countryDiv.setAttribute('data-territory', (index % 4).toString());
            countryDiv.setAttribute('data-country-id', id);
            
            const angle = (index / countryEntries.length) * 2 * Math.PI;
            const left = centerX + radius * Math.cos(angle);
            const top = centerY + radius * Math.sin(angle);
            
            countryDiv.style.left = left + '%';
            countryDiv.style.top = top + '%';
            countryDiv.style.transform = 'translate(-50%, -50%)';
            
            if (index === 0 || id === this.currentPlayerId) {
                countryDiv.classList.add('has-capital');
            }
            
            if (country.lives <= 1) {
                countryDiv.classList.add('conflict');
            }
            
            if (id === this.currentPlayerId) {
                countryDiv.classList.add('selected');
            }
            
            countryDiv.innerHTML = `
                <div class="territory-info">
                    <h4>${country.name}</h4>
                    <div class="stats">
                        <div class="stat-item">♥ ${country.lives}</div>
                        <div class="stat-item">💰 ${country.gold?.toFixed(1) || 0}</div>
                        <div class="stat-item">⚔ ${country.soldiers || 0}</div>
                        <div class="stat-item">📊 ${country.level}</div>
                    </div>
                </div>
                <div class="resource-indicator">
                    ${country.gold > 5 ? '<div class="resource-dot gold" title="Rich in gold"></div>' : ''}
                    ${country.soldiers > 3 ? '<div class="resource-dot soldier" title="Military presence"></div>' : ''}
                </div>
                ${country.soldiers > 5 ? '<div class="military-base" title="Military installation"></div>' : ''}
            `;
            
            countryDiv.onclick = (e) => {
                e.stopPropagation();
                this.selectTerritory(id, countryDiv);
            };
            
            mapContainer.appendChild(countryDiv);
        });
        
        await this.drawConnectionLines(countries, mapContainer);
    }

    async drawConnectionLines(countries, container) {
        document.querySelectorAll('.connection-line').forEach(el => el.remove());
        
        const countryElements = container.querySelectorAll('.map-country');
        if (countryElements.length < 2) return;
        
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const positions = new Map();
        const containerRect = container.getBoundingClientRect();
        
        countryElements.forEach((el) => {
            const rect = el.getBoundingClientRect();
            positions.set(el.dataset.countryId, {
                x: ((rect.left + rect.width / 2) - containerRect.left) / containerRect.width * 100,
                y: ((rect.top + rect.height / 2) - containerRect.top) / containerRect.height * 100,
                element: el
            });
        });
        
        let svgOverlay = container.querySelector('.map-lines-svg');
        if (!svgOverlay) {
            svgOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svgOverlay.classList.add('map-lines-svg');
            svgOverlay.style.position = 'absolute';
            svgOverlay.style.top = '0';
            svgOverlay.style.left = '0';
            svgOverlay.style.width = '100%';
            svgOverlay.style.height = '100%';
            svgOverlay.style.pointerEvents = 'none';
            container.style.position = 'relative';
            container.appendChild(svgOverlay);
        }
        
        while (svgOverlay.firstChild) {
            svgOverlay.removeChild(svgOverlay.firstChild);
        }
        
        const drawnConnections = new Set();
        
        for (const [id, country] of Object.entries(countries)) {
            if (country.isAlive === false) continue;
            if (country.neighbors && country.neighbors.length > 0) {
                const startPos = positions.get(id);
                if (!startPos) continue;
                
                country.neighbors.forEach(neighborId => {
                    const neighborCountry = countries[neighborId];
                    if (!neighborCountry || neighborCountry.isAlive === false) return;
                    
                    const connectionKey = [id, neighborId].sort().join('-');
                    if (drawnConnections.has(connectionKey)) return;
                    drawnConnections.add(connectionKey);
                    
                    const endPos = positions.get(neighborId);
                    if (!endPos) return;
                    
                    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                    
                    const x1 = (startPos.x / 100) * containerRect.width;
                    const y1 = (startPos.y / 100) * containerRect.height;
                    const x2 = (endPos.x / 100) * containerRect.width;
                    const y2 = (endPos.y / 100) * containerRect.height;
                    
                    line.setAttribute('x1', x1);
                    line.setAttribute('y1', y1);
                    line.setAttribute('x2', x2);
                    line.setAttribute('y2', y2);
                    line.setAttribute('stroke', '#00ffcc');
                    line.setAttribute('stroke-width', '2');
                    line.setAttribute('stroke-dasharray', '5,5');
                    line.setAttribute('opacity', '0.6');
                    
                    if (id === this.currentPlayerId || neighborId === this.currentPlayerId) {
                        line.setAttribute('stroke', '#00ffcc');
                        line.setAttribute('stroke-width', '3');
                        line.setAttribute('opacity', '1');
                        line.setAttribute('stroke-dasharray', 'none');
                    }
                    
                    svgOverlay.appendChild(line);
                });
            }
        }
    }

    setupResizeHandler() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (this.currentPlayerId && this.gameActive) {
                    this.updateMap();
                }
            }, 250);
        });
    }

    addTerrainFeatures(container) {
        for (let i = 0; i < 5; i++) {
            const mountain = document.createElement('div');
            mountain.className = 'terrain-feature mountain';
            mountain.style.left = Math.random() * 90 + '%';
            mountain.style.top = Math.random() * 90 + '%';
            container.appendChild(mountain);
        }
        
        for (let i = 0; i < 8; i++) {
            const forest = document.createElement('div');
            forest.className = 'terrain-feature forest';
            forest.style.left = Math.random() * 90 + '%';
            forest.style.top = Math.random() * 90 + '%';
            container.appendChild(forest);
        }
    }

    selectTerritory(countryId, element) {
        document.querySelectorAll('.map-country').forEach(el => {
            el.classList.remove('selected');
        });
        
        element.classList.add('selected');
        this.showCountryDetails(countryId);
        
        document.querySelectorAll('.connection-line').forEach(line => {
            line.classList.remove('active');
        });
        
        setTimeout(() => {
            document.querySelectorAll('.connection-line').forEach(line => {
                if (Math.random() > 0.7) {
                    line.classList.add('active');
                }
            });
        }, 100);
    }

    async logAction(actionType, details, targetId = null, result = null) {
    if (!this.currentPlayerId) return;
    
    try {
        const playerSnapshot = await countriesRef.child(this.currentPlayerId).once('value');
        const player = playerSnapshot.val();
        
        if (!player) return;
        
        const logEntry = {
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            playerId: this.currentPlayerId,
            playerName: player.name,
            playerType: player.type,
            action: actionType,
            details: details,
            targetId: targetId,
            result: result,
            gold: player.gold || 0,
            soldiers: player.soldiers || 0,
            actions: player.actions || 0,
            level: player.level || 1
        };
        
        await actionsLogRef.push().set(logEntry);
        
        // Keep only last 1000 logs to prevent database bloat
        const logsSnapshot = await actionsLogRef.orderByKey().limitToLast(1000).once('value');
        const logs = logsSnapshot.val();
        if (logs) {
            const logKeys = Object.keys(logs);
            if (logKeys.length > 1000) {
                const toDelete = logKeys.slice(0, logKeys.length - 1000);
                for (const key of toDelete) {
                    await actionsLogRef.child(key).remove();
                }
            }
        }
    } catch (error) {
        console.error('Error logging action:', error);
    }
}

    async updateNeighborSelectors() {
        if (!this.currentPlayerId) return;
        
        try {
            const snapshot = await countriesRef.once('value');
            const countries = snapshot.val();
            
            if (!countries) {
                console.log('No countries found');
                return;
            }
            
            const player = countries[this.currentPlayerId];
            if (!player || player.isAlive === false) {
                console.log('Current player not found or dead');
                return;
            }
            
            const countryEntries = Object.entries(countries);
            
            const neighborSelect = document.getElementById('neighborSelect');
            if (neighborSelect) {
                neighborSelect.innerHTML = '<option value="">Select a neighbor...</option>';
                
                if (player.neighbors && player.neighbors.length > 0) {
                    for (const neighborId of player.neighbors) {
                        const neighbor = countries[neighborId];
                        if (neighbor && neighbor.isAlive !== false) {
                            const option = document.createElement('option');
                            option.value = neighborId;
                            option.textContent = `${neighbor.name} (${neighbor.type})`;
                            neighborSelect.appendChild(option);
                        }
                    }
                } else {
                    const option = document.createElement('option');
                    option.value = "";
                    option.textContent = "No neighbors yet";
                    option.disabled = true;
                    neighborSelect.appendChild(option);
                }
            }
            
            const tradePartnerSelect = document.getElementById('tradePartner');
            if (tradePartnerSelect) {
                tradePartnerSelect.innerHTML = '<option value="">Select player to trade with...</option>';
                
                let hasOtherPlayers = false;
                
                countryEntries.forEach(([id, country]) => {
                    if (id !== this.currentPlayerId && country.isAlive !== false) {
                        hasOtherPlayers = true;
                        const option = document.createElement('option');
                        option.value = id;
                        
                        const isNeighbor = player.neighbors && player.neighbors.includes(id);
                        const neighborTag = isNeighbor ? ' [NEIGHBOR]' : '';
                        
                        option.textContent = `${country.name} (${country.type})${neighborTag} - ❤️${country.lives} 💰${country.gold || 0}`;
                        tradePartnerSelect.appendChild(option);
                    }
                });
                
                if (!hasOtherPlayers) {
                    const option = document.createElement('option');
                    option.value = "";
                    option.textContent = "No other players yet";
                    option.disabled = true;
                    tradePartnerSelect.appendChild(option);
                }
            }
            
            this.updateMap();
            
        } catch (error) {
            console.error('Error updating neighbor selectors:', error);
        }
    }

    showCountryDetails(countryId) {
        console.log('Show details for:', countryId);
    }

    showMessage(message, type) {
        const resultDiv = document.getElementById('attackResult');
        if (resultDiv) {
            resultDiv.textContent = message;
            resultDiv.className = type;
            setTimeout(() => {
                resultDiv.textContent = '';
                resultDiv.className = '';
            }, 3000);
        } else {
            alert(message);
        }
    }

    updateGameTime(gameState) {
        // Implement if needed
    }
}

// Create and expose game instance AFTER the class definition
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, creating game instance...');
    try {
        window.game = new Game();
        console.log('Game instance created and attached to window');
    } catch (error) {
        console.error('Failed to create game instance:', error);
    }
});