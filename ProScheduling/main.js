 const $ = (sel, root=document) => root.querySelector(sel);
      const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

      const algorithmSelect = $('#algorithm');
      const quantumWrap = $('#quantum-wrap');
      const quantumInput = $('#quantum');
      const procBody = $('#proc-body');
      const thPriority = $('#th-priority');
      const resThPriority = $('#res-th-priority');
      const ganttEl = $('#gantt');
      const timesEl = $('#times');
      const kpisEl = $('#kpis');
      const errorEl = $('#error');

      const COLORS = ['c1','c2','c3','c4','c5'];

      function uidPID(base, taken){
        let i=1;
        while(taken.has(base + i)) i++;
        return base + i;
      }

      function togglePriorityColumn(show){
        thPriority.style.display = show ? '' : 'none';
        resThPriority.style.display = show ? '' : 'none';
        $$('.td-priority', procBody).forEach(td => td.style.display = show ? '' : 'none');
      }

      function ensureQuantumVisibility(){
        const v = algorithmSelect.value;
        quantumWrap.style.display = (v === 'RR') ? '' : 'none';
        togglePriorityColumn(v === 'PRIORITY');
      }

      function addRow(prefill={}){
        const tpl = $('#row-tpl');
        const tr = tpl.content.firstElementChild.cloneNode(true);
        const pid = $('.pid', tr);
        const at = $('.at', tr);
        const bt = $('.bt', tr);
        const pr = $('.prio', tr);
        pid.value = prefill.pid ?? '';
        at.value = prefill.at ?? '';
        bt.value = prefill.bt ?? '';
        pr.value = prefill.priority ?? '';
        $('.btn-del', tr).addEventListener('click', () => tr.remove());
        procBody.appendChild(tr);
        ensureQuantumVisibility();
      }

      function clearRows(){
        procBody.innerHTML = '';
      }

      function parseProcesses(){
        const rows = $$('#proc-body tr');
        const procs = [];
        const seen = new Set();
        for(let i=0;i<rows.length;i++){
          const pid = $('.pid', rows[i]).value.trim();
          const at = Number($('.at', rows[i]).value);
          const bt = Number($('.bt', rows[i]).value);
          const prioNode = $('.prio', rows[i]);
          const prioVal = prioNode ? prioNode.value : '';
          const priority = prioNode && prioNode.closest('td').style.display !== 'none'
            ? (prioVal === '' ? NaN : Number(prioVal))
            : null;

          if(!pid) throw new Error(`Row ${i+1}: PID is required`);
          if(seen.has(pid)) throw new Error(`Duplicate PID "${pid}". PIDs must be unique.`);
          seen.add(pid);

          if(!Number.isFinite(at) || at < 0 || !Number.isInteger(at))
            throw new Error(`Row ${i+1}: Arrival must be a non-negative integer`);
          if(!Number.isFinite(bt) || bt <= 0 || !Number.isInteger(bt))
            throw new Error(`Row ${i+1}: Burst must be a positive integer`);

          if(algorithmSelect.value === 'PRIORITY'){
            if(!Number.isFinite(priority))
              throw new Error(`Row ${i+1}: Priority required (integer; smaller is higher)`);
            if(!Number.isInteger(priority))
              throw new Error(`Row ${i+1}: Priority must be integer`);
          }

          procs.push({
            pid, at, bt,
            priority: priority ?? null,
            remaining: bt,
            startTime: null,
            completion: null,
            response: null,
            index: i, // stable tie-breaker
          });
        }
        if(procs.length === 0) throw new Error('Add at least one process.');
        return procs;
      }

      // Scheduling helpers
      function pushSegment(segments, pid, start, end){
        if(start === end) return;
        const last = segments[segments.length-1];
        if(last && last.pid === pid && Math.abs(last.end - start) < 1e-9){
          last.end = end; // merge contiguous same-pid segments
        } else {
          segments.push({ pid, start, end });
        }
      }

      function nextArrivalAfter(procs, t){
        const after = procs
          .filter(p => p.at > t && p.remaining > 0)
          .map(p => p.at);
        return after.length ? Math.min(...after) : null;
      }

      function allDone(procs){
        return procs.every(p => p.remaining === 0);
      }

      function pickBy(procs, t, cmp){
        // Among arrived and not done, pick according to cmp
        const ready = procs.filter(p => p.at <= t && p.remaining > 0);
        if(ready.length === 0) return null;
        ready.sort(cmp);
        return ready[0];
      }

      // Non-preemptive schedulers
      function scheduleFCFS(procs){
        const segments = [];
        let t = Math.min(...procs.map(p => p.at));
        const order = [...procs].sort((a,b) => a.at - b.at || a.index - b.index);
        for(const p of order){
          if(t < p.at){
            pushSegment(segments, 'IDLE', t, p.at);
            t = p.at;
          }
          p.startTime ??= t;
          p.response = p.startTime - p.at;
          pushSegment(segments, p.pid, t, t + p.bt);
          t += p.bt;
          p.remaining = 0;
          p.completion = t;
        }
        return segments;
      }

      function scheduleSJF(procs){
        const segments = [];
        let t = Math.min(...procs.map(p => p.at));
        while(!allDone(procs)){
          const pick = pickBy(procs, t, (a,b) =>
            a.bt - b.bt || a.at - b.at || a.index - b.index
          );
          if(!pick){
            const nextAt = nextArrivalAfter(procs, t);
            pushSegment(segments, 'IDLE', t, nextAt);
            t = nextAt;
            continue;
          }
          pick.startTime ??= t;
          pick.response = pick.startTime - pick.at;
          pushSegment(segments, pick.pid, t, t + pick.bt);
          t += pick.bt;
          pick.remaining = 0;
          pick.completion = t;
        }
        return segments;
      }

      function scheduleLJF(procs){
        const segments = [];
        let t = Math.min(...procs.map(p => p.at));
        while(!allDone(procs)){
          const pick = pickBy(procs, t, (a,b) =>
            b.bt - a.bt || a.at - b.at || a.index - b.index
          );
          if(!pick){
            const nextAt = nextArrivalAfter(procs, t);
            pushSegment(segments, 'IDLE', t, nextAt);
            t = nextAt;
            continue;
          }
          pick.startTime ??= t;
          pick.response = pick.startTime - pick.at;
          pushSegment(segments, pick.pid, t, t + pick.bt);
          t += pick.bt;
          pick.remaining = 0;
          pick.completion = t;
        }
        return segments;
      }

      function scheduleHRRN(procs){
        const segments = [];
        let t = Math.min(...procs.map(p => p.at));
        while(!allDone(procs)){
          const ready = procs.filter(p => p.at <= t && p.remaining > 0);
          if(ready.length === 0){
            const nextAt = nextArrivalAfter(procs, t);
            pushSegment(segments, 'IDLE', t, nextAt);
            t = nextAt;
            continue;
          }
          ready.forEach(r => r.rr = ((t - r.at) + r.bt) / r.bt);
          ready.sort((a,b) => b.rr - a.rr || a.at - b.at || a.index - b.index);
          const pick = ready[0];
          pick.startTime ??= t;
          pick.response = pick.startTime - pick.at;
          pushSegment(segments, pick.pid, t, t + pick.bt);
          t += pick.bt;
          pick.remaining = 0;
          pick.completion = t;
        }
        return segments;
      }

      // Preemptive step-by-step schedulers
      function scheduleSRJF(procs){
        const segments = [];
        let t = Math.min(...procs.map(p => p.at));
        let running = null;
        while(!allDone(procs)){
          const ready = procs.filter(p => p.at <= t && p.remaining > 0);
          if(ready.length === 0){
            const nextAt = nextArrivalAfter(procs, t);
            pushSegment(segments, 'IDLE', t, nextAt);
            t = nextAt;
            running = null;
            continue;
          }
          ready.sort((a,b) => a.remaining - b.remaining || a.at - b.at || a.index - b.index);
          const pick = ready[0];
          if(running !== pick){
            // switch
            running = pick;
            running.startTime ??= t;
            if(running.response === null) running.response = running.startTime - running.at;
          }
          // run one unit
          pushSegment(segments, running.pid, t, t+1);
          running.remaining -= 1;
          t += 1;
          if(running.remaining === 0){
            running.completion = t;
            running = null;
          }
        }
        return segments;
      }

      function scheduleLRJB(procs){
        const segments = [];
        let t = Math.min(...procs.map(p => p.at));
        let running = null;
        while(!allDone(procs)){
          const ready = procs.filter(p => p.at <= t && p.remaining > 0);
          if(ready.length === 0){
            const nextAt = nextArrivalAfter(procs, t);
            pushSegment(segments, 'IDLE', t, nextAt);
            t = nextAt;
            running = null;
            continue;
          }
          ready.sort((a,b) => b.remaining - a.remaining || a.at - b.at || a.index - b.index);
          const pick = ready[0];
          if(running !== pick){
            running = pick;
            running.startTime ??= t;
            if(running.response === null) running.response = running.startTime - running.at;
          }
          pushSegment(segments, running.pid, t, t+1);
          running.remaining -= 1;
          t += 1;
          if(running.remaining === 0){
            running.completion = t;
            running = null;
          }
        }
        return segments;
      }

      // Round Robin
      function scheduleRR(procs, quantum){
        const segments = [];
        const byArrival = [...procs].sort((a,b)=> a.at - b.at || a.index - b.index);
        let t = Math.min(...procs.map(p=>p.at));
        const q = Math.max(1, quantum|0);

        const queue = [];
        let i=0;
        // enqueue all arrived at t
        while(i<byArrival.length && byArrival[i].at <= t){
          queue.push(byArrival[i++]);
        }

        while(!allDone(procs)){
          if(queue.length === 0){
            const nextAt = nextArrivalAfter(procs, t);
            pushSegment(segments, 'IDLE', t, nextAt);
            t = nextAt;
            while(i<byArrival.length && byArrival[i].at <= t){
              queue.push(byArrival[i++]);
            }
            continue;
          }
          const p = queue.shift();
          p.startTime ??= t;
          if(p.response === null) p.response = p.startTime - p.at;

          let slice = Math.min(q, p.remaining);
          // Run the time slice; add arrivals as time advances
          for(let step=0; step<slice; step++){
            pushSegment(segments, p.pid, t, t+1);
            t += 1;
            p.remaining -= 1;
            while(i<byArrival.length && byArrival[i].at <= t){
              queue.push(byArrival[i++]);
            }
            if(p.remaining === 0){
              p.completion = t;
              break;
            }
          }
          if(p.remaining > 0){
            queue.push(p);
          }
        }
        return segments;
      }

      function schedulePriority(procs){
        // Non-preemptive, smaller number = higher priority
        const segments = [];
        let t = Math.min(...procs.map(p => p.at));
        while(!allDone(procs)){
          const pick = pickBy(procs, t, (a,b) =>
            (a.priority - b.priority) || a.at - b.at || a.index - b.index
          );
          if(!pick){
            const nextAt = nextArrivalAfter(procs, t);
            pushSegment(segments, 'IDLE', t, nextAt);
            t = nextAt;
            continue;
          }
          pick.startTime ??= t;
          pick.response = pick.startTime - pick.at;
          pushSegment(segments, pick.pid, t, t + pick.bt);
          t += pick.bt;
          pick.remaining = 0;
          pick.completion = t;
        }
        return segments;
      }

      function runSchedule(algorithm, procs, quantum){
        // Deep copy core fields to avoid mutating inputs between runs
        const P = procs.map(p => ({
          pid:p.pid, at:p.at, bt:p.bt, priority:p.priority,
          remaining:p.bt, startTime:null, completion:null, response:null, index:p.index
        }));
        let segments = [];
        switch(algorithm){
          case 'FCFS': segments = scheduleFCFS(P); break;
          case 'SJF': segments = scheduleSJF(P); break;
          case 'LJF': segments = scheduleLJF(P); break;
          case 'HRRN': segments = scheduleHRRN(P); break;
          case 'SRJF': segments = scheduleSRJF(P); break;
          case 'LRJB': segments = scheduleLRJB(P); break;
          case 'RR': segments = scheduleRR(P, quantum); break;
          case 'PRIORITY': segments = schedulePriority(P); break;
          default: throw new Error('Unknown algorithm');
        }
        // Compute per-process metrics
        const results = P.map(p => {
          const ct = p.completion ?? 0;
          const tat = ct - p.at;
          const wt = tat - p.bt;
          const rt = p.response ?? 0;
          return {
            pid: p.pid, at: p.at, bt: p.bt, priority: p.priority,
            start: p.startTime ?? null, completion: ct,
            tat, wt, rt
          };
        });
        return { segments, results };
      }

      function renderGantt(segments){
        ganttEl.innerHTML = '';
        timesEl.innerHTML = '';

        if(segments.length === 0) return;

        const totalEnd = Math.max(...segments.map(s => s.end));
        const starts = [...new Set(segments.map(s => s.start))];
        // Build segments with proportional flex-basis
        segments.forEach((s, idx) => {
          const dur = s.end - s.start;
          const seg = document.createElement('div');
          seg.className = 'segment ' + (s.pid === 'IDLE' ? 'idle' : COLORS[idx % COLORS.length]);
          seg.style.flexBasis = (dur / totalEnd * 100) + '%';
          seg.setAttribute('role','listitem');
          seg.setAttribute('aria-label', s.pid === 'IDLE'
            ? `Idle from ${s.start} to ${s.end}`
            : `Process ${s.pid} from ${s.start} to ${s.end}`
          );
          seg.textContent = s.pid;
          ganttEl.appendChild(seg);
        });

        // Time labels at segment boundaries
        const boundaryTimes = Array.from(new Set(segments.flatMap(s => [s.start, s.end]))).sort((a,b)=>a-b);
        boundaryTimes.forEach((t,i) => {
          const tick = document.createElement('div');
          tick.className = 'tick';
          tick.textContent = t;
          tick.style.flexBasis = (i === boundaryTimes.length-1)
            ? 'auto'
            : ((boundaryTimes[i+1] - boundaryTimes[i]) / totalEnd * 100) + '%';
          timesEl.appendChild(tick);
        });
      }

      function renderResults(results){
        const tbody = $('#res-body');
        tbody.innerHTML = '';
        let sumTAT=0, sumWT=0, sumRT=0;

        results.forEach((r, i) => {
          sumTAT += r.tat;
          sumWT += r.wt;
          sumRT += r.rt;

          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${r.pid}</td>
            <td>${r.at}</td>
            <td>${r.bt}</td>
            <td class="res-td-priority" style="${algorithmSelect.value==='PRIORITY' ? '' : 'display:none;'}">${r.priority ?? ''}</td>
            <td>${r.start ?? '-'}</td>
            <td>${r.completion}</td>
            <td>${r.tat}</td>
            <td>${r.wt}</td>
            <td>${r.rt}</td>
          `;
          tbody.appendChild(tr);
        });

        const n = results.length || 1;
        kpisEl.innerHTML = `
          <div><strong>Avg TAT :</strong> ${(sumTAT/n).toFixed(2)}</div>
          <div><strong>Avg WT :</strong> ${(sumWT/n).toFixed(2)}</div>
          <div><strong>Avg RT :</strong> ${(sumRT/n).toFixed(2)}</div>
        `;
      }

      // Event handlers
      algorithmSelect.addEventListener('change', ensureQuantumVisibility);

      $('#add-proc').addEventListener('click', () => {
        const taken = new Set($$('.pid', procBody).map(i=>i.value.trim()).filter(Boolean));
        addRow({ pid: uidPID('P', taken) });
      });

      $('#clear-proc').addEventListener('click', () => {
        clearRows();
        errorEl.textContent = '';
        ganttEl.innerHTML = '';
        timesEl.innerHTML = '';
        kpisEl.innerHTML = '';
        $('#res-body').innerHTML = '';
      });

      $('#start').addEventListener('click', () => {
        try{
          errorEl.textContent = '';
          const procs = parseProcesses();
          const algo = algorithmSelect.value;
          const quantum = Number(quantumInput.value);
          if(algo === 'RR'){
            if(!Number.isFinite(quantum) || quantum < 1 || !Number.isInteger(quantum)){
              throw new Error('Quantum must be a positive integer for Round Robin.');
            }
          }
          const { segments, results } = runSchedule(algo, procs, quantum);
          renderGantt(segments);
          renderResults(results);
        }catch(err){
          errorEl.textContent = err.message || String(err);
        }
      });

      // Initial rows
      function seed(){
        clearRows();
        addRow({ pid:'P1', at:0, bt:5, priority:1 });
        addRow({ pid:'P2', at:2, bt:3, priority:2 });
        addRow({ pid:'P3', at:4, bt:1, priority:3 });
        ensureQuantumVisibility();
      }
      seed();
