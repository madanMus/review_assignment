// Review Assignment Tool - Client-Side Implementation
// All processing happens in the browser for privacy

class ReviewAssignmentSolver {
    constructor() {
        this.data = {
            pcinfo: null,
            papers: null,
            prefs: null,
            tpms: null,
            aliases: null,
            conflicts: null
        };
        this.round = 'R1';
        this.setupEventListeners();
    }

    setupEventListeners() {
        // File upload listeners
        const fileInputs = ['pcinfo', 'papers', 'prefs', 'tpms', 'aliases', 'conflicts'];
        fileInputs.forEach(id => {
            document.getElementById(id).addEventListener('change', (e) => this.handleFileUpload(e, id));
        });

        // Round selection
        document.getElementById('round').addEventListener('change', (e) => {
            this.round = e.target.value;
            this.checkReadyToSolve();
        });

        // Solve button
        document.getElementById('solveBtn').addEventListener('click', () => this.solve());
    }

    async handleFileUpload(event, type) {
        const file = event.target.files[0];
        if (!file) return;

        const statusEl = document.getElementById(`status-${type}`);
        statusEl.textContent = '⏳ Loading...';
        statusEl.className = 'status';

        try {
            const hasHeader = type !== 'tpms'; // TPMS scores has no header
            const data = await this.parseCSV(file, hasHeader);
            this.data[type] = data;
            statusEl.textContent = `✓ Loaded (${data.length} rows)`;
            statusEl.className = 'status loaded';
            this.checkReadyToSolve();
        } catch (error) {
            statusEl.textContent = `✗ Error: ${error.message}`;
            statusEl.className = 'status error';
        }
    }

    parseCSV(file, hasHeader = true) {
        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: hasHeader,
                dynamicTyping: true,
                skipEmptyLines: 'greedy',  // More aggressive at skipping empty lines in quoted fields
                newline: '',  // Auto-detect newlines
                quoteChar: '"',
                escapeChar: '"',
                complete: (results) => {
                    if (results.errors.length > 0) {
                        // Log errors but be lenient with field mismatches
                        console.log('CSV Parse Errors:', results.errors);
                        const criticalErrors = results.errors.filter(e => 
                            e.type !== 'FieldMismatch'
                        );
                        if (criticalErrors.length > 0) {
                            reject(new Error(criticalErrors[0].message));
                        } else {
                            resolve(results.data);
                        }
                    } else {
                        resolve(results.data);
                    }
                },
                error: (error) => reject(error)
            });
        });
    }

    checkReadyToSolve() {
        const required = ['pcinfo', 'papers', 'prefs', 'tpms', 'aliases'];
        const allLoaded = required.every(key => this.data[key] !== null);
        document.getElementById('solveBtn').disabled = !allLoaded;
    }

    async solve() {
        document.getElementById('loading').style.display = 'block';
        document.getElementById('results').style.display = 'none';
        document.getElementById('solveBtn').disabled = true;

        try {
            // Give UI time to update
            await new Promise(resolve => setTimeout(resolve, 100));

            // Process data
            const pcinfo = this.processPCInfo(this.data.pcinfo);
            const papers = this.processPapers(this.data.papers);
            const { pcinfo: updatedPcinfo, papers: updatedPapers } = this.applyRoundLogic(pcinfo, papers);
            const topics = this.processTopicScores(this.data.prefs, updatedPcinfo, updatedPapers);
            const tpms = this.processTPMS(this.data.tpms, this.data.aliases, updatedPcinfo, updatedPapers);
            const scores = this.computeScores(updatedPcinfo, updatedPapers, topics, tpms);
            const conflicts = this.processConflicts(this.data.conflicts, updatedPcinfo);

            // Solve assignment problem
            const assignments = this.solveAssignments(updatedPcinfo, updatedPapers, topics, scores, conflicts);

            if (assignments) {
                this.displayResults(assignments, updatedPcinfo, updatedPapers, topics, tpms, scores);
            }
        } catch (error) {
            this.displayError(error);
        } finally {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('solveBtn').disabled = false;
        }
    }

    processPCInfo(data) {
        // Remove chairs
        let pcinfo = data.filter(row => !row.roles || !row.roles.includes('chair'));
        
        // Process topics (find columns starting with 'topic:')
        const topicCols = Object.keys(pcinfo[0]).filter(k => k.startsWith('topic:'));
        
        // Mark full PC members
        pcinfo = pcinfo.map(row => ({
            ...row,
            full_pc: row.tags && row.tags.includes('full') ? 1 : 0,
            topic_cols: topicCols.map(col => row[col] || 0)
        }));

        return pcinfo;
    }

    processPapers(data) {
        // Filter only submitted papers
        return data.filter(row => row.Status === 'Submitted').map(row => ({
            paper: row.ID,
            title: row.Title,
            status: row.Status
        }));
    }

    applyRoundLogic(pcinfo, papers) {
        const numR1Reviews = 2;
        const numR2Reviews = 4;

        if (this.round === 'R1') {
            papers = papers.map(p => ({ ...p, num_reviews: numR1Reviews }));
            pcinfo = pcinfo.map(pc => ({
                ...pc,
                max_load: pc.full_pc === 1 ? 7 : 3
            }));
        } else if (this.round === 'R2') {
            // For R2, would need R2 papers file - simplified for now
            papers = papers.map(p => ({ ...p, num_reviews: numR1Reviews }));
            pcinfo = pcinfo.map(pc => ({
                ...pc,
                max_load: pc.full_pc === 1 ? 12 : 5
            }));
        } else if (this.round === 'DL') {
            papers = papers.map(p => ({ ...p, num_reviews: 1 }));
            pcinfo = pcinfo.map(pc => ({
                ...pc,
                max_load: pc.full_pc === 1 ? 2 : 1
            }));
        }

        return { pcinfo, papers };
    }

    processTopicScores(allprefs, pcinfo, papers) {
        // Filter to only include PC members
        const pcEmails = new Set(pcinfo.map(pc => pc.email));
        let topics = allprefs.filter(row => pcEmails.has(row.email));

        // Normalize topic scores
        const topicScores = topics.map(t => t.topic_score);
        const min = Math.min(...topicScores);
        const max = Math.max(...topicScores);
        const range = max - min;

        topics = topics.map(row => ({
            ...row,
            norm_topic_score: range > 0 ? (row.topic_score - min) / range : 0,
            conflict: row.conflict === 'conflict' ? 'conflict' : null
        }));

        // Map preferences
        topics = topics.map(row => {
            let pref = row.preference || 0;
            let prefScore;
            if (pref >= 20) prefScore = 1; // expert
            else if (pref > 0 && pref < 20) prefScore = 0.75; // like
            else if (pref > -999 && pref <= 0) prefScore = 0; // don't want
            else prefScore = 0; // conflict

            if (pref <= -999) {
                return { ...row, preference: 0, conflict: 'conflict' };
            }
            return { ...row, preference: prefScore };
        });

        return topics;
    }

    processTPMS(tpmsData, aliasData, pcinfo, papers) {
        // Parse TPMS (headerless: paper, tpms_email, tpms_score)
        const tpms = tpmsData.map(row => {
            const values = Array.isArray(row) ? row : Object.values(row);
            return {
                paper: values[0],
                tpms_email: values[1],
                tpms_score: values[2]
            };
        });

        // Create alias map
        const aliasMap = {};
        aliasData.forEach(row => {
            aliasMap[row.tpms_email] = row.alias_email;
        });

        // Apply aliases
        return tpms.map(row => ({
            paper: row.paper,
            email: aliasMap[row.tpms_email] || row.tpms_email,
            tpms_score: row.tpms_score
        }));
    }

    computeScores(pcinfo, papers, topics, tpms) {
        const scores = [];
        
        // Create cross product of PC members and papers
        for (const pc of pcinfo) {
            for (const paper of papers) {
                const topicMatch = topics.find(t => t.email === pc.email && t.paper === paper.paper);
                const tpmsMatch = tpms.find(t => t.email === pc.email && t.paper === paper.paper);

                const preference = topicMatch ? (topicMatch.preference || 0) : 0;
                const normTopicScore = topicMatch ? (topicMatch.norm_topic_score || 0) : 0;
                const tpmsScore = tpmsMatch ? (tpmsMatch.tpms_score || 0) : 0;

                // Weighted score: 1/3 each
                const totalScore = (preference + tpmsScore + normTopicScore) / 3;

                scores.push({
                    email: pc.email,
                    paper: paper.paper,
                    preference,
                    norm_topic_score: normTopicScore,
                    tpms_score: tpmsScore,
                    total_score: totalScore,
                    conflict: topicMatch?.conflict || null
                });
            }
        }

        return scores;
    }

    processConflicts(conflictsData, pcinfo) {
        if (!conflictsData || conflictsData.length === 0) {
            return [];
        }

        const pcEmails = new Set(pcinfo.map(pc => pc.email));
        const conflicts = conflictsData.filter(row => 
            pcEmails.has(row.email) && pcEmails.has(row.conflict_email)
        );

        // Make symmetric
        const conflictSet = new Set();
        conflicts.forEach(c => {
            const pair = [c.email, c.conflict_email].sort();
            conflictSet.add(pair.join('|'));
        });

        return Array.from(conflictSet).map(pair => {
            const [email, conflict_email] = pair.split('|');
            return { email, conflict_email };
        });
    }

    solveAssignments(pcinfo, papers, topics, scores, conflicts) {
        // This is a greedy approximation algorithm
        // For optimal solution, would need to port OR-Tools CP-SAT solver to JS
        // or use WebAssembly version
        
        const assignments = [];
        const pcLoads = {};
        const paperReviews = {};
        
        // Initialize
        pcinfo.forEach(pc => pcLoads[pc.email] = 0);
        papers.forEach(p => paperReviews[p.paper] = 0);

        // Sort scores in descending order
        const sortedScores = [...scores]
            .filter(s => !s.conflict) // Remove conflicts
            .sort((a, b) => b.total_score - a.total_score);

        // Greedy assignment
        for (const score of sortedScores) {
            const pc = pcinfo.find(p => p.email === score.email);
            const paper = papers.find(p => p.paper === score.paper);
            
            if (!pc || !paper) continue;

            // Check if we can assign
            if (pcLoads[score.email] >= pc.max_load) continue;
            if (paperReviews[score.paper] >= paper.num_reviews) continue;

            // Check PC conflicts
            const hasConflict = conflicts.some(c => 
                (c.email === score.email || c.conflict_email === score.email) &&
                assignments.some(a => 
                    a.paper === score.paper && 
                    (a.email === c.email || a.email === c.conflict_email)
                )
            );

            if (hasConflict) continue;

            // Assign
            assignments.push({
                email: score.email,
                paper: score.paper,
                score: score.total_score
            });

            pcLoads[score.email]++;
            paperReviews[score.paper]++;
        }

        // Check if all papers got required reviews
        const unassignedPapers = papers.filter(p => paperReviews[p.paper] < p.num_reviews);
        if (unassignedPapers.length > 0) {
            throw new Error(`Could not assign enough reviewers to ${unassignedPapers.length} papers. Try adjusting constraints.`);
        }

        return assignments;
    }

    displayResults(assignments, pcinfo, papers, topics, tpms, scores) {
        const resultsDiv = document.getElementById('results');
        resultsDiv.style.display = 'block';
        
        // Calculate statistics
        const pcLoads = {};
        const paperReviewCounts = {};
        
        assignments.forEach(a => {
            pcLoads[a.email] = (pcLoads[a.email] || 0) + 1;
            paperReviewCounts[a.paper] = (paperReviewCounts[a.paper] || 0) + 1;
        });

        // Load distribution
        const loadDist = {};
        Object.values(pcLoads).forEach(load => {
            loadDist[load] = (loadDist[load] || 0) + 1;
        });

        // Average scores
        const avgScore = assignments.reduce((sum, a) => sum + a.score, 0) / assignments.length;

        // Preference distribution
        const prefDist = {};
        assignments.forEach(a => {
            const scoreEntry = scores.find(s => s.email === a.email && s.paper === a.paper);
            if (scoreEntry) {
                const pref = scoreEntry.preference;
                prefDist[pref] = (prefDist[pref] || 0) + 1;
            }
        });

        let html = '<h2>✅ Assignment Complete!</h2>';
        
        html += '<div class="result-section">';
        html += '<h3>Summary Statistics</h3>';
        html += `<p><strong>Total Assignments:</strong> ${assignments.length}</p>`;
        html += `<p><strong>Average Score:</strong> ${avgScore.toFixed(3)}</p>`;
        html += `<p><strong>PC Members:</strong> ${pcinfo.length}</p>`;
        html += `<p><strong>Papers:</strong> ${papers.length}</p>`;
        html += '</div>';

        html += '<div class="result-section">';
        html += '<h3>Load Distribution</h3>';
        html += '<pre>';
        Object.entries(loadDist).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([load, count]) => {
            html += `${load} reviews: ${count} PC members\n`;
        });
        html += '</pre>';
        html += '</div>';

        html += '<div class="result-section">';
        html += '<h3>Preference Distribution</h3>';
        html += '<pre>';
        Object.entries(prefDist).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])).forEach(([pref, count]) => {
            const prefLabel = pref === '1' ? 'Expert' : pref === '0.75' ? 'Like' : 'Neutral';
            html += `${prefLabel} (${pref}): ${count} assignments\n`;
        });
        html += '</pre>';
        html += '</div>';

        html += '<div class="result-section">';
        html += '<h3>Download Results</h3>';
        html += this.createDownloadLinks(assignments, pcinfo, papers, topics, tpms, scores);
        html += '</div>';

        resultsDiv.innerHTML = html;
    }

    createDownloadLinks(assignments, pcinfo, papers, topics, tpms, scores) {
        // Create CSV for assignments
        const assignmentCSV = this.generateAssignmentCSV(assignments);
        const detailsCSV = this.generateDetailsCSV(assignments, pcinfo, papers, topics, tpms, scores);

        const assignmentBlob = new Blob([assignmentCSV], { type: 'text/csv' });
        const detailsBlob = new Blob([detailsCSV], { type: 'text/csv' });

        const assignmentURL = URL.createObjectURL(assignmentBlob);
        const detailsURL = URL.createObjectURL(detailsBlob);

        return `
            <a href="${assignmentURL}" download="assignments-${this.round}.csv" class="download-btn">
                📥 Download Assignments
            </a>
            <a href="${detailsURL}" download="assignment-details-${this.round}.csv" class="download-btn">
                📥 Download Detailed Report
            </a>
        `;
    }

    generateAssignmentCSV(assignments) {
        if (this.round === 'DL') {
            let csv = 'paper,action,email\n';
            assignments.forEach(a => {
                csv += `${a.paper},lead,${a.email}\n`;
            });
            return csv;
        } else {
            let csv = 'paper,assignment,email,round\n';
            assignments.forEach(a => {
                csv += `${a.paper},primaryreview,${a.email},${this.round}\n`;
            });
            return csv;
        }
    }

    generateDetailsCSV(assignments, pcinfo, papers, topics, tpms, scores) {
        let csv = 'paper,email,score,preference,norm_topic_score,tpms_score,pc_name,paper_title\n';
        
        assignments.forEach(a => {
            const pc = pcinfo.find(p => p.email === a.email);
            const paper = papers.find(p => p.paper === a.paper);
            const scoreEntry = scores.find(s => s.email === a.email && s.paper === a.paper);
            
            const pcName = pc ? `${pc.given_name} ${pc.family_name}` : '';
            const paperTitle = paper ? paper.title : '';
            
            csv += `${a.paper},${a.email},${a.score.toFixed(3)},`;
            csv += `${scoreEntry?.preference || 0},`;
            csv += `${scoreEntry?.norm_topic_score.toFixed(3) || 0},`;
            csv += `${scoreEntry?.tpms_score.toFixed(3) || 0},`;
            csv += `"${pcName}","${paperTitle}"\n`;
        });
        
        return csv;
    }

    displayError(error) {
        const resultsDiv = document.getElementById('results');
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = `
            <div class="error-message">
                <h3>❌ Error</h3>
                <p>${error.message}</p>
                <p style="margin-top: 10px;"><small>Note: This is a simplified greedy algorithm. For optimal results, use the Python version with OR-Tools.</small></p>
            </div>
        `;
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    new ReviewAssignmentSolver();
});
