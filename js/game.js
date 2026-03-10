// game.js
class Game {
    constructor() {
        console.log('Game constructor called');
        this.currentPlayer = null;
        this.currentPlayerId = null;
        this.gameInterval = null;
        this.tradeListeners = [];
        
        // Check if database is available
        if (typeof database !== 'undefined' && database) {
            this.initializeGame();
        } else {
            console.error("Database not initialized");
            // Retry after a short delay
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
    }

    setupListeners() {
        if (!database) {
            console.error('Database not available for listeners');
            return;
        }
        
        // Listen for game state changes
        gameStateRef.on('value', (snapshot) => {
            const gameState = snapshot.val();
            if (gameState) {
                this.updateGameTime(gameState);
            }
        });

        // Listen for country updates
        countriesRef.on('child_changed', (snapshot) => {
            const updatedCountry = snapshot.val();
            if (snapshot.key === this.currentPlayerId) {
                this.updatePlayerUI(updatedCountry);
            }
            this.updateNeighborSelectors();
            this.updateMap();
        });

        countriesRef.on('child_added', () => {
            this.updateNeighborSelectors();
            this.updateMap();
        });

        countriesRef.on('child_removed', () => {
            this.updateNeighborSelectors();
            this.updateMap();
        });
    }

    setupTradeListeners() {
        if (!database || !tradesRef) {
            console.error('Database not available for trade listeners');
            return;
        }
        
        // Listen for new trades sent to current player
        tradesRef.on('child_added', (snapshot) => {
            if (!this.currentPlayerId) return;
            const trade = snapshot.val();
            if (trade.toId === this.currentPlayerId && trade.status === 'pending') {
                this.showTradeNotification(trade);
            }
            if (trade.fromId === this.currentPlayerId || trade.toId === this.currentPlayerId) {
                this.updateMyTrades();
            }
        });

        // Listen for trade status changes
        tradesRef.on('child_changed', (snapshot) => {
            if (!this.currentPlayerId) return;
            const trade = snapshot.val();
            if (trade.toId === this.currentPlayerId || trade.fromId === this.currentPlayerId) {
                this.handleTradeUpdate(trade);
                this.updateMyTrades();
            }
        });

        // Listen for trade removals
        tradesRef.on('child_removed', (snapshot) => {
            if (!this.currentPlayerId) return;
            this.updateMyTrades();
        });
    }

    async createCountry(countryData) {
        try {
            const newCountryRef = countriesRef.push();
            const countryId = newCountryRef.key;
            
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
                flag: countryData.flag || null,
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                lastDailyUpdate: firebase.database.ServerValue.TIMESTAMP
            };

            await newCountryRef.set(country);
            
            // Set as current player
            this.currentPlayerId = countryId;
            this.currentPlayer = country;
            localStorage.setItem('playerId', countryId);
            
            // Hide creation modal and show dashboard
            document.getElementById('creationModal').classList.add('hidden');
            document.getElementById('playerDashboard').classList.remove('hidden');
            
            // Update neighbors based on existing countries
            await this.updateNeighbors(countryId);
            
            // Force update the neighbor selectors
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
            
            // For simplicity, each country is neighbor with up to 3 closest countries
            const neighbors = otherCountries.slice(0, Math.min(3, otherCountries.length));
            
            // Update new country's neighbors
            await countriesRef.child(newCountryId).child('neighbors').set(neighbors);
            
            // Add new country as neighbor to others
            for (const countryId of otherCountries) {
                const countryNeighbors = (countries[countryId].neighbors || []);
                if (!countryNeighbors.includes(newCountryId) && countryNeighbors.length < 3) {
                    countryNeighbors.push(newCountryId);
                    await countriesRef.child(countryId).child('neighbors').set(countryNeighbors);
                }
            }
        }
    }

    startDailyTimer() {
        this.gameInterval = setInterval(async () => {
            await this.checkDailyUpdate();
        }, 60000);
        
        setInterval(() => this.updateCountdown(), 1000);
    }

    async checkDailyUpdate() {
        if (!this.currentPlayerId) return;
        
        const snapshot = await countriesRef.child(this.currentPlayerId).once('value');
        const country = snapshot.val();
        
        if (!country) return;
        
        const now = Date.now();
        const lastUpdate = country.lastDailyUpdate || now;
        const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);
        
        if (hoursSinceUpdate >= 24) {
            await this.performDailyUpdate(this.currentPlayerId, country);
        }
    }

    async performDailyUpdate(countryId, country) {
        const updates = {};
        
        let goldEarned = GAME_CONFIG.BASE_GOLD_PER_DAY;
        let actionsEarned = GAME_CONFIG.BASE_ACTIONS_PER_DAY;
        
        if (country.type === 'economic' && country.level > 1) {
            for (let i = 2; i <= country.level; i++) {
                if (GAME_CONFIG.ECONOMIC_BONUSES[i]?.goldPerDay) {
                    goldEarned += GAME_CONFIG.ECONOMIC_BONUSES[i].goldPerDay;
                }
            }
        }
        
        const daysSinceUpdate = Math.floor((Date.now() - country.lastDailyUpdate) / (1000 * 60 * 60 * 24));
        if (daysSinceUpdate >= 7) {
            const weeksPassed = Math.floor(daysSinceUpdate / 7);
            const newUpgradePoints = Math.max(0, (country.upgradePoints || 0) - (weeksPassed * GAME_CONFIG.UPGRADE_WEEKLY_DECAY));
            updates.upgradePoints = newUpgradePoints;
        }
        
        updates.gold = (country.gold || 0) + goldEarned;
        updates.actions = actionsEarned;
        updates.lastDailyUpdate = firebase.database.ServerValue.TIMESTAMP;
        
        await countriesRef.child(countryId).update(updates);
    }

    async buySoldier() {
        if (!this.currentPlayerId) return;
        
        const snapshot = await countriesRef.child(this.currentPlayerId).once('value');
        const country = snapshot.val();
        
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
        } else {
            this.showMessage(`Not enough gold! Need ${soldierCost} gold.`, 'failure');
        }
    }

    async fortify(targetId = null) {
        if (!this.currentPlayerId) return;
        
        const target = targetId || this.currentPlayerId;
        const snapshot = await countriesRef.child(target).once('value');
        const country = snapshot.val();
        
        if (!country) return;
        
        if (target !== this.currentPlayerId) {
            const playerSnapshot = await countriesRef.child(this.currentPlayerId).once('value');
            const player = playerSnapshot.val();
            if (!player.neighbors || !player.neighbors.includes(target)) {
                this.showMessage('You can only heal neighboring countries!', 'failure');
                return;
            }
        }
        
        if (target === this.currentPlayerId) {
            const playerSnapshot = await countriesRef.child(this.currentPlayerId).once('value');
            const player = playerSnapshot.val();
            
            if (player.actions < 1) {
                this.showMessage('Not enough actions!', 'failure');
                return;
            }
            
            let goldCost = 0;
            if (player.type === 'economic' && player.level >= 4) {
                goldCost = 2;
                if (player.gold < goldCost) {
                    this.showMessage(`Not enough gold! Need ${goldCost} gold to fortify.`, 'failure');
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
            } else {
                this.showMessage('Already at maximum lives!', 'failure');
            }
        }
    }

    async attack(neighborId) {
        if (!this.currentPlayerId || !neighborId) return;
        
        const attackerSnapshot = await countriesRef.child(this.currentPlayerId).once('value');
        const attacker = attackerSnapshot.val();
        const defenderSnapshot = await countriesRef.child(neighborId).once('value');
        const defender = defenderSnapshot.val();
        
        if (!defender) {
            this.showMessage('Target country not found!', 'failure');
            return;
        }
        
        if (attacker.soldiers < 1) {
            this.showMessage('Need at least 1 soldier to attack!', 'failure');
            return;
        }
        
        if (attacker.actions < 1) {
            this.showMessage('Need 1 action to attack!', 'failure');
            return;
        }
        
        if (!attacker.neighbors || !attacker.neighbors.includes(neighborId)) {
            this.showMessage('You can only attack neighboring countries!', 'failure');
            return;
        }
        
        let attackSuccess = Math.random() < 0.5;
        
        if (!attackSuccess && attacker.type === 'wartime' && attacker.level >= 2) {
            if (attacker.gold >= 2) {
                if (confirm('Attack failed! Spend 2 gold to reroll?')) {
                    attackSuccess = Math.random() < 0.5;
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
                defenderUpdates.lives = GAME_CONFIG.STARTING_LIVES;
                defenderUpdates.gold = 0;
                defenderUpdates.soldiers = 0;
                
                updates.name = defender.name;
                updates.type = defender.type;
                
                this.showMessage(`You conquered ${defender.name}!`, 'success');
            } else {
                updates.gold = (attacker.gold || 0) + 1;
                this.showMessage('Attack successful! Stole 1 gold!', 'success');
            }
            
            await countriesRef.child(neighborId).update(defenderUpdates);
        } else {
            this.showMessage('Attack failed!', 'failure');
        }
        
        await countriesRef.child(this.currentPlayerId).update(updates);
    }

    async upgrade() {
        if (!this.currentPlayerId) return;
        
        const snapshot = await countriesRef.child(this.currentPlayerId).once('value');
        const country = snapshot.val();
        
        if (country.actions < 1) {
            this.showMessage('Not enough actions!', 'failure');
            return;
        }
        
        if (country.level >= 4) {
            this.showMessage('Already at maximum level!', 'failure');
            return;
        }
        
        const newUpgradePoints = (country.upgradePoints || 0) + 1;
        const nextLevel = country.level + 1;
        const requiredPoints = GAME_CONFIG.UPGRADE_REQUIREMENTS[nextLevel];
        
        const updates = {
            actions: country.actions - 1,
            upgradePoints: newUpgradePoints
        };
        
        if (newUpgradePoints >= requiredPoints) {
            updates.level = nextLevel;
            updates.upgradePoints = newUpgradePoints - requiredPoints;
            this.showMessage(`Level Up! Now level ${nextLevel}!`, 'success');
        }
        
        await countriesRef.child(this.currentPlayerId).update(updates);
    }

    async proposeTrade(tradeData) {
        if (!this.currentPlayerId) {
            this.showMessage('You must create a country first!', 'failure');
            return;
        }
        
        try {
            const snapshot = await countriesRef.child(this.currentPlayerId).once('value');
            const player = snapshot.val();
            
            if (player.gold < tradeData.gold) {
                this.showMessage(`You don't have ${tradeData.gold} gold!`, 'failure');
                return;
            }
            
            if (player.soldiers < tradeData.soldiers) {
                this.showMessage(`You don't have ${tradeData.soldiers} soldiers!`, 'failure');
                return;
            }
            
            if (tradeData.actions > 0) {
                if (!player.neighbors || !player.neighbors.includes(tradeData.partnerId)) {
                    this.showMessage('Actions can only be traded with neighboring countries!', 'failure');
                    return;
                }
                
                if (player.actions < tradeData.actions) {
                    this.showMessage(`You don't have ${tradeData.actions} actions!`, 'failure');
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
            
            document.getElementById('tradeGold').value = '';
            document.getElementById('tradeSoldiers').value = '';
            document.getElementById('tradeActions').value = '';
            
        } catch (error) {
            console.error('Error proposing trade:', error);
            this.showMessage('Failed to propose trade', 'failure');
        }
    }

    async acceptTrade(tradeId) {
        try {
            const tradeSnapshot = await tradesRef.child(tradeId).once('value');
            const trade = tradeSnapshot.val();
            
            if (!trade || trade.status !== 'pending') {
                this.showMessage('This trade is no longer available', 'failure');
                return;
            }
            
            if (trade.toId !== this.currentPlayerId) {
                this.showMessage('This trade is not for you!', 'failure');
                return;
            }
            
            const receiverSnapshot = await countriesRef.child(this.currentPlayerId).once('value');
            const receiver = receiverSnapshot.val();
            
            const receiverUpdates = {
                gold: (receiver.gold || 0) + trade.gold,
                soldiers: (receiver.soldiers || 0) + trade.soldiers,
                actions: (receiver.actions || 0) + trade.actions
            };
            
            await tradesRef.child(tradeId).update({ 
                status: 'accepted',
                acceptedAt: firebase.database.ServerValue.TIMESTAMP
            });
            
            await countriesRef.child(this.currentPlayerId).update(receiverUpdates);
            
            this.showMessage(`Trade accepted! Received resources`, 'success');
            this.removeTradeNotification(tradeId);
            
        } catch (error) {
            console.error('Error accepting trade:', error);
            this.showMessage('Failed to accept trade', 'failure');
        }
    }

    async rejectTrade(tradeId) {
        try {
            const tradeSnapshot = await tradesRef.child(tradeId).once('value');
            const trade = tradeSnapshot.val();
            
            if (!trade || trade.status !== 'pending') return;
            
            const senderSnapshot = await countriesRef.child(trade.fromId).once('value');
            const sender = senderSnapshot.val();
            
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
        try {
            const tradeSnapshot = await tradesRef.child(tradeId).once('value');
            const trade = tradeSnapshot.val();
            
            if (!trade || trade.status !== 'pending') return;
            if (trade.fromId !== this.currentPlayerId) return;
            
            const senderSnapshot = await countriesRef.child(this.currentPlayerId).once('value');
            const sender = senderSnapshot.val();
            
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
                    
                    const senderUpdates = {
                        gold: (sender.gold || 0) + trade.gold,
                        soldiers: (sender.soldiers || 0) + trade.soldiers
                    };
                    
                    if (trade.actions > 0) {
                        senderUpdates.actions = (sender.actions || 0) + trade.actions;
                    }
                    
                    await countriesRef.child(trade.fromId).update(senderUpdates);
                    await tradesRef.child(id).update({ status: 'expired' });
                    
                    this.removeTradeNotification(id);
                }
            }
        }, 60000);
    }

    checkExistingSession() {
        const savedPlayerId = localStorage.getItem('playerId');
        if (savedPlayerId) {
            countriesRef.child(savedPlayerId).once('value', (snapshot) => {
                if (snapshot.exists()) {
                    this.currentPlayerId = savedPlayerId;
                    this.currentPlayer = snapshot.val();
                    document.getElementById('creationModal').classList.add('hidden');
                    document.getElementById('playerDashboard').classList.remove('hidden');
                    this.updatePlayerUI(this.currentPlayer);
                    this.updateNeighborSelectors();
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
        const now = Date.now();
        const nextDay = new Date(now);
        nextDay.setHours(24, 0, 0, 0);
        
        const timeLeft = nextDay - now;
        
        if (timeLeft > 0) {
            const hours = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
            
            document.getElementById('gameTimer').textContent = 
                `Next Day: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    async updateMap() {
        const snapshot = await countriesRef.once('value');
        const countries = snapshot.val();
        const mapContainer = document.getElementById('mapContainer');
        
        if (!mapContainer || !countries) return;
        
        mapContainer.innerHTML = '';
        
        Object.values(countries).forEach(country => {
            const countryDiv = document.createElement('div');
            countryDiv.className = `map-country ${country.type}`;
            countryDiv.innerHTML = `
                <h4>${country.name}</h4>
                <p>❤️ ${country.lives} | 💰 ${country.gold?.toFixed(1) || 0}</p>
                <p>⚔️ ${country.soldiers || 0} | 📊 Lvl ${country.level}</p>
            `;
            countryDiv.onclick = () => this.showCountryDetails(country.id);
            mapContainer.appendChild(countryDiv);
        });
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
            if (!player) {
                console.log('Current player not found');
                return;
            }
            
            const countryEntries = Object.entries(countries);
            
            const neighborSelect = document.getElementById('neighborSelect');
            if (neighborSelect) {
                neighborSelect.innerHTML = '<option value="">Select a neighbor...</option>';
                
                if (player.neighbors && player.neighbors.length > 0) {
                    player.neighbors.forEach(neighborId => {
                        const neighbor = countries[neighborId];
                        if (neighbor) {
                            const option = document.createElement('option');
                            option.value = neighborId;
                            option.textContent = `${neighbor.name} (${neighbor.type})`;
                            neighborSelect.appendChild(option);
                        }
                    });
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
                    if (id !== this.currentPlayerId) {
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