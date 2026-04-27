// Admin Panel Controller
class AdminPanel {
    constructor() {
        this.countriesRef = countriesRef;
        this.tradesRef = tradesRef;
        this.actionsLogRef = actionsLogRef;
        this.allLogs = [];
        this.setupListeners();
        this.loadData();
        this.startAutoRefresh();
    }

    setupListeners() {
        // Listen for real-time updates
        if (this.countriesRef) {
            this.countriesRef.on('value', () => {
                this.loadData();
                this.updateLastUpdateTime();
            });
        }

        if (this.tradesRef) {
            this.tradesRef.on('value', () => {
                this.loadTrades();
            });
        }

        if (this.actionsLogRef) {
            this.actionsLogRef.on('value', () => {
                this.loadActionLogs();
            });
        }

        // Button listeners
        document.getElementById('refreshData')?.addEventListener('click', () => this.loadData());
        document.getElementById('resetGame')?.addEventListener('click', () => this.resetGame());
        document.getElementById('clearDefeated')?.addEventListener('click', () => this.clearDefeatedCountries());
        document.getElementById('exportData')?.addEventListener('click', () => this.exportData());
        
        document.getElementById('searchCountries')?.addEventListener('input', () => this.filterCountries());
        document.getElementById('filterType')?.addEventListener('change', () => this.filterCountries());
        document.getElementById('filterStatus')?.addEventListener('change', () => this.filterCountries());

        document.getElementById('logFilterAction')?.addEventListener('change', () => this.filterLogs());
        document.getElementById('logFilterResult')?.addEventListener('change', () => this.filterLogs());
        document.getElementById('logSearchPlayer')?.addEventListener('input', () => this.filterLogs());
    }

    startAutoRefresh() {
        setInterval(() => {
            this.loadData();
        }, 30000); // Refresh every 30 seconds
    }

    updateLastUpdateTime() {
        const now = new Date();
        const timeString = now.toLocaleTimeString();
        const lastUpdateSpan = document.getElementById('lastUpdate');
        if (lastUpdateSpan) {
            lastUpdateSpan.textContent = `Last update: ${timeString}`;
        }
    }

    async loadData() {
        try {
            const snapshot = await this.countriesRef.once('value');
            const countries = snapshot.val();
            
            if (countries) {
                this.updateGlobalStats(countries);
                this.updateMap(countries);
                this.updateCountriesList(countries);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    async loadTrades() {
        try {
            const snapshot = await this.tradesRef.once('value');
            const trades = snapshot.val();
            this.updateTradesList(trades);
        } catch (error) {
            console.error('Error loading trades:', error);
        }
    }

    async loadActionLogs() {
        try {
            const snapshot = await this.actionsLogRef.orderByKey().limitToLast(500).once('value');
            const logs = snapshot.val();
            
            if (logs) {
                this.allLogs = Object.entries(logs).map(([id, log]) => ({
                    id,
                    ...log
                })).reverse(); // Most recent first
                
                document.getElementById('totalActions').textContent = this.allLogs.length;
                this.filterLogs();
            } else {
                this.allLogs = [];
                document.getElementById('totalActions').textContent = '0';
                this.renderLogs([]);
            }
        } catch (error) {
            console.error('Error loading action logs:', error);
        }
    }

    filterLogs() {
        const actionFilter = document.getElementById('logFilterAction')?.value || 'all';
        const resultFilter = document.getElementById('logFilterResult')?.value || 'all';
        const searchPlayer = document.getElementById('logSearchPlayer')?.value.toLowerCase() || '';
        
        let filtered = this.allLogs;
        
        if (actionFilter !== 'all') {
            filtered = filtered.filter(log => log.action === actionFilter);
        }
        
        if (resultFilter !== 'all') {
            filtered = filtered.filter(log => log.result === resultFilter);
        }
        
        if (searchPlayer) {
            filtered = filtered.filter(log => 
                log.playerName?.toLowerCase().includes(searchPlayer)
            );
        }
        
        this.renderLogs(filtered);
    }

     renderLogs(logs) {
        const logsContainer = document.getElementById('actionLogsList');
        if (!logsContainer) return;
        
        if (logs.length === 0) {
            logsContainer.innerHTML = '<div class="log-entry">No action logs found</div>';
            return;
        }
        
        logsContainer.innerHTML = logs.map(log => {
            const date = new Date(log.timestamp);
            const timeString = date.toLocaleString();
            
            let resultClass = '';
            let resultIcon = '';
            switch(log.result) {
                case 'success':
                case 'sent':
                    resultClass = 'log-result-success';
                    resultIcon = '✅';
                    break;
                case 'failed':
                    resultClass = 'log-result-failed';
                    resultIcon = '❌';
                    break;
                case 'victory':
                    resultClass = 'log-result-victory';
                    resultIcon = '🏆';
                    break;
                case 'level_up':
                    resultClass = 'log-result-levelup';
                    resultIcon = '⭐';
                    break;
                default:
                    resultClass = 'log-result-info';
                    resultIcon = 'ℹ️';
            }
            
            let actionIcon = '';
            switch(log.action) {
                case 'BUY_SOLDIER': actionIcon = '⚔️'; break;
                case 'FORTIFY': actionIcon = '🛡️'; break;
                case 'ATTACK': actionIcon = '🎯'; break;
                case 'UPGRADE': actionIcon = '📊'; break;
                case 'TRADE_PROPOSE': actionIcon = '📨'; break;
                case 'TRADE_ACCEPT': actionIcon = '✅'; break;
                case 'TRADE_REJECT': actionIcon = '❌'; break;
                case 'DAILY_RESET': actionIcon = '🌙'; break;
                default: actionIcon = '📝';
            }
            
            return `
                <div class="log-entry ${resultClass}">
                    <div class="log-time">${timeString}</div>
                    <div class="log-player">
                        <span class="player-type ${log.playerType}">${log.playerType === 'economic' ? '💰' : '⚔️'}</span>
                        <strong>${log.playerName}</strong>
                    </div>
                    <div class="log-action">
                        <span class="action-icon">${actionIcon}</span>
                        <span class="action-name">${log.action.replace('_', ' ')}</span>
                    </div>
                    <div class="log-details">${log.details}</div>
                    <div class="log-result">
                        <span class="result-icon">${resultIcon}</span>
                        <span class="result-text">${log.result}</span>
                    </div>
                    ${log.targetId ? `<div class="log-target">🎯 Target: ${log.targetId.substring(0, 8)}...</div>` : ''}
                    <div class="log-stats">
                        <small>💰 ${log.gold?.toFixed(1) || 0} | ⚔️ ${log.soldiers || 0} | 🎯 ${log.actions || 0} | 📊 Lv.${log.level || 1}</small>
                    </div>
                </div>
            `;
        }).join('');
    }

    async clearLogs() {
        if (confirm('⚠️ WARNING: This will delete ALL action logs! Are you sure?')) {
            if (confirm('LAST CHANCE: This action cannot be undone. Type "CLEAR LOGS" to confirm.')) {
                const confirmation = prompt('Type "CLEAR LOGS" to confirm:');
                if (confirmation === 'CLEAR LOGS') {
                    try {
                        await this.actionsLogRef.remove();
                        alert('Action logs have been cleared!');
                        this.loadActionLogs();
                    } catch (error) {
                        console.error('Error clearing logs:', error);
                        alert('Failed to clear logs. Check console for details.');
                    }
                }
            }
        }
    }

    async exportLogs() {
        if (this.allLogs.length === 0) {
            alert('No logs to export.');
            return;
        }
        
        const dataStr = JSON.stringify(this.allLogs, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `action_logs_${new Date().toISOString()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        alert(`Exported ${this.allLogs.length} action logs!`);
    }





     updateGlobalStats(countries) {
        const countriesArray = Object.values(countries);
        const total = countriesArray.length;
        const active = countriesArray.filter(c => c.isAlive !== false).length;
        const eliminated = total - active;
        const economic = countriesArray.filter(c => c.type === 'economic' && c.isAlive !== false).length;
        const wartime = countriesArray.filter(c => c.type === 'wartime' && c.isAlive !== false).length;
        const totalGold = countriesArray.reduce((sum, c) => sum + (c.gold || 0), 0);
        const totalSoldiers = countriesArray.reduce((sum, c) => sum + (c.soldiers || 0), 0);

        document.getElementById('totalNations').textContent = total;
        document.getElementById('activeNations').textContent = active;
        document.getElementById('eliminatedNations').textContent = eliminated;
        document.getElementById('economicCount').textContent = economic;
        document.getElementById('wartimeCount').textContent = wartime;
        document.getElementById('totalGold').textContent = Math.floor(totalGold);
        document.getElementById('totalSoldiers').textContent = totalSoldiers;
    }

    updateMap(countries) {
        const mapContainer = document.getElementById('adminMapContainer');
        if (!mapContainer) return;

        // Clear existing map
        const existingCountries = mapContainer.querySelectorAll('.map-country');
        existingCountries.forEach(el => el.remove());
        
        const existingSvg = mapContainer.querySelector('.map-lines-svg');
        if (existingSvg) existingSvg.remove();

        const countryEntries = Object.entries(countries);
        if (countryEntries.length === 0) return;

        const centerX = 50;
        const centerY = 50;
        const radius = 35;

        // Create territories
        countryEntries.forEach(([id, country], index) => {
            const countryDiv = document.createElement('div');
            countryDiv.className = `map-country ${country.type}`;
            if (country.isAlive === false) {
                countryDiv.classList.add('defeated');
            }
            countryDiv.setAttribute('data-country-id', id);
            
            const angle = (index / countryEntries.length) * 2 * Math.PI;
            const left = centerX + radius * Math.cos(angle);
            const top = centerY + radius * Math.sin(angle);
            
            countryDiv.style.left = left + '%';
            countryDiv.style.top = top + '%';
            countryDiv.style.transform = 'translate(-50%, -50%)';
            
            countryDiv.innerHTML = `
                <h4>${country.name}</h4>
                <div class="stats">
                    <div>❤️ ${country.lives}</div>
                    <div>💰 ${country.gold?.toFixed(1) || 0}</div>
                    <div>⚔️ ${country.soldiers || 0}</div>
                    <div>📊 Lv.${country.level}</div>
                </div>
            `;
            
            countryDiv.onclick = () => this.showCountryDetails(id, country);
            mapContainer.appendChild(countryDiv);
        });

        this.drawConnectionLines(countries, mapContainer);
    }

    drawConnectionLines(countries, container) {
        const countryElements = container.querySelectorAll('.map-country');
        if (countryElements.length < 2) return;

        const positions = new Map();
        const containerRect = container.getBoundingClientRect();
        
        countryElements.forEach((el) => {
            const rect = el.getBoundingClientRect();
            positions.set(el.dataset.countryId, {
                x: ((rect.left + rect.width / 2) - containerRect.left) / containerRect.width * 100,
                y: ((rect.top + rect.height / 2) - containerRect.top) / containerRect.height * 100
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
                    
                    svgOverlay.appendChild(line);
                });
            }
        }
    }

    updateCountriesList(countries) {
        const countriesList = document.getElementById('countriesList');
        if (!countriesList) return;

        // Store raw data for filtering
        this.allCountries = Object.entries(countries).map(([id, country]) => ({
            id,
            ...country
        }));

        this.filterCountries();
    }

    filterCountries() {
        const searchTerm = document.getElementById('searchCountries')?.value.toLowerCase() || '';
        const typeFilter = document.getElementById('filterType')?.value || 'all';
        const statusFilter = document.getElementById('filterStatus')?.value || 'all';

        if (!this.allCountries) return;

        const filtered = this.allCountries.filter(country => {
            const matchesSearch = country.name.toLowerCase().includes(searchTerm);
            const matchesType = typeFilter === 'all' || country.type === typeFilter;
            const matchesStatus = statusFilter === 'all' || 
                (statusFilter === 'active' && country.isAlive !== false) ||
                (statusFilter === 'defeated' && country.isAlive === false);
            
            return matchesSearch && matchesType && matchesStatus;
        });

        this.renderCountriesList(filtered);
    }

    renderCountriesList(countries) {
        const countriesList = document.getElementById('countriesList');
        if (!countriesList) return;

        if (countries.length === 0) {
            countriesList.innerHTML = '<div class="country-card">No countries found</div>';
            return;
        }

        countriesList.innerHTML = countries.map(country => `
            <div class="country-card ${country.isAlive === false ? 'defeated' : ''}" onclick="adminPanel.showCountryDetails('${country.id}', null)">
                <div class="country-header">
                    <span class="country-name">${country.name}</span>
                    <span class="country-type ${country.type}">${country.type.toUpperCase()}</span>
                    <span class="country-status ${country.isAlive !== false ? 'active' : 'defeated'}">
                        ${country.isAlive !== false ? 'ACTIVE' : 'DEFEATED'}
                    </span>
                </div>
                <div class="country-stats">
                    <div class="stat"><span class="stat-icon">❤️</span> ${country.lives}</div>
                    <div class="stat"><span class="stat-icon">💰</span> ${country.gold?.toFixed(1) || 0}</div>
                    <div class="stat"><span class="stat-icon">⚔️</span> ${country.soldiers || 0}</div>
                    <div class="stat"><span class="stat-icon">🎯</span> ${country.actions || 0}</div>
                    <div class="stat"><span class="stat-icon">📊</span> Lv.${country.level}</div>
                    <div class="stat"><span class="stat-icon">🔗</span> ${country.neighbors?.length || 0} neighbors</div>
                </div>
            </div>
        `).join('');
    }

    updateTradesList(trades) {
        const tradesList = document.getElementById('tradesList');
        if (!tradesList) return;

        if (!trades) {
            tradesList.innerHTML = '<div class="trade-card">No active trades</div>';
            return;
        }

        const activeTrades = Object.values(trades).filter(t => t.status === 'pending');
        document.getElementById('activeTrades').textContent = activeTrades.length;

        if (activeTrades.length === 0) {
            tradesList.innerHTML = '<div class="trade-card">No active trades</div>';
            return;
        }

        tradesList.innerHTML = activeTrades.map(trade => `
            <div class="trade-card">
                <div class="trade-info">
                    <span>📨 From: ${trade.fromName || trade.fromId}</span>
                    <span>➡️ To: ${trade.toId}</span>
                    <span>💰 ${trade.gold} gold</span>
                    <span>⚔️ ${trade.soldiers} soldiers</span>
                    <span>🎯 ${trade.actions} actions</span>
                </div>
                <span class="trade-badge pending">PENDING</span>
            </div>
        `).join('');
    }

    async showCountryDetails(countryId, countryData) {
        let country = countryData;
        if (!country) {
            const snapshot = await this.countriesRef.child(countryId).once('value');
            country = snapshot.val();
        }
        
        if (!country) return;

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>${country.name}</h2>
                <div class="country-stats" style="grid-template-columns: 1fr 1fr;">
                    <div><strong>Type:</strong> ${country.type}</div>
                    <div><strong>Status:</strong> ${country.isAlive !== false ? '🟢 Active' : '💀 Defeated'}</div>
                    <div><strong>Lives:</strong> ${country.lives}</div>
                    <div><strong>Gold:</strong> ${country.gold?.toFixed(1) || 0}</div>
                    <div><strong>Soldiers:</strong> ${country.soldiers || 0}</div>
                    <div><strong>Actions:</strong> ${country.actions || 0}</div>
                    <div><strong>Level:</strong> ${country.level}</div>
                    <div><strong>Upgrade Points:</strong> ${country.upgradePoints || 0}</div>
                    <div><strong>Neighbors:</strong> ${country.neighbors?.length || 0}</div>
                    <div><strong>Created:</strong> ${new Date(country.createdAt).toLocaleDateString()}</div>
                </div>
                <div style="margin-top: 20px;">
                    <strong>Neighbor IDs:</strong>
                    <div style="max-height: 100px; overflow-y: auto; background: #0a1a0a; padding: 10px; margin-top: 5px;">
                        ${country.neighbors?.length ? country.neighbors.join(', ') : 'No neighbors'}
                    </div>
                </div>
                <button onclick="this.closest('.modal').remove()">Close</button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close on click outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    async resetGame() {
        if (confirm('⚠️ WARNING: This will delete ALL game data! Are you sure?')) {
            if (confirm('LAST CHANCE: This action cannot be undone. Type "RESET" to confirm.')) {
                const confirmation = prompt('Type "RESET" to confirm:');
                if (confirmation === 'RESET') {
                    try {
                        await this.countriesRef.remove();
                        await this.tradesRef.remove();
                        localStorage.clear();
                        alert('Game has been reset!');
                        this.loadData();
                        this.loadTrades();
                    } catch (error) {
                        console.error('Error resetting game:', error);
                        alert('Failed to reset game. Check console for details.');
                    }
                }
            }
        }
    }

    async clearDefeatedCountries() {
        if (confirm('Delete all defeated countries? This cannot be undone.')) {
            const snapshot = await this.countriesRef.once('value');
            const countries = snapshot.val();
            
            if (!countries) return;
            
            const defeatedIds = Object.entries(countries)
                .filter(([id, country]) => country.isAlive === false)
                .map(([id]) => id);
            
            if (defeatedIds.length === 0) {
                alert('No defeated countries to clear.');
                return;
            }
            
            if (confirm(`Delete ${defeatedIds.length} defeated countries?`)) {
                for (const id of defeatedIds) {
                    await this.countriesRef.child(id).remove();
                }
                alert(`Cleared ${defeatedIds.length} defeated countries.`);
                this.loadData();
            }
        }
    }

    exportData() {
        this.countriesRef.once('value', (snapshot) => {
            const data = snapshot.val();
            const dataStr = JSON.stringify(data, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `diplomatic_backup_${new Date().toISOString()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            alert('Data exported successfully!');
        });
    }
}

// Initialize admin panel
let adminPanel;
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof database !== 'undefined' && database) {
            adminPanel = new AdminPanel();
            window.adminPanel = adminPanel;
        } else {
            console.error('Firebase not initialized');
            document.getElementById('countriesList').innerHTML = 
                '<div class="country-card">Error: Firebase not connected. Check your configuration.</div>';
        }
    }, 500);
});