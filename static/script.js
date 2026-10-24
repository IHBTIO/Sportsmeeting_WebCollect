(function () {
  'use strict';
  var pageSize = 50, currentPage = 1, allRecords = [], selectedIds = {}, maxEvents = 2;

  function setMessage(el, text, type, autoCloseMs) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'message ' + (type || 'info');
    el.style.display = text ? 'block' : 'none';
    if (text && autoCloseMs) setTimeout(() => { if (el.textContent === text) el.style.display = 'none'; }, autoCloseMs);
  }

  function requestJSON(url, options) {
    var opts = options || {}; opts.credentials = 'same-origin';
    return fetch(url, opts).then(res => res.json().then(data => {
      if (!res.ok || data.ok === false) { var e = new Error(data.message || '请求失败'); e.status = res.status; throw e; }
      return data;
    }));
  }

  function fillDeptAndClass(deptSelect, classSelect, deptList, classMap) {
    deptSelect.innerHTML = '<option value="">请选择学部</option>';
    deptList.forEach(d => { deptSelect.innerHTML += `<option value="${d}">${d}</option>`; });
    deptSelect.addEventListener('change', function () {
      var d = this.value;
      classSelect.innerHTML = '<option value="">请选择班级</option>';
      if (!d) { classSelect.disabled = true; return; }
      classSelect.disabled = false;
      (classMap[d] || []).forEach(c => { classSelect.innerHTML += `<option value="${c}">${c}</option>`; });
    });
  }

  /* 学生端 */
  function initRegisterPage() {
    var form = document.getElementById('regForm'), deptSelect = document.getElementById('department'), classSelect = document.getElementById('className');
    var eventList = document.getElementById('eventList'), msgEl = document.getElementById('message'), banner = document.getElementById('statusBanner'), submitBtn = document.getElementById('submitBtn');
    
    requestJSON('/api/meta').then(data => {
      maxEvents = data.max_events || 2;
      document.getElementById('maxEventsTxt').textContent = maxEvents;
      document.getElementById('maxEvents').textContent = maxEvents;
      
      if (data.registration_notice) {
        document.getElementById('noticeBox').style.display = 'block';
        document.getElementById('marqueeText').textContent = data.registration_notice + ' '.repeat(20);
      }
      fillDeptAndClass(deptSelect, classSelect, data.departments, data.classes_by_department);
      
      eventList.innerHTML = '';
      data.projects.forEach(p => {
        eventList.innerHTML += `<label class="checkbox"><input type="checkbox" name="events" value="${p}"><span>${p}</span></label>`;
      });

      eventList.addEventListener('change', function(e) {
        if (e.target.name !== 'events') return;
        var checked = eventList.querySelectorAll('input[name="events"]:checked');
        if (checked.length > maxEvents) {
          e.target.checked = false;
          setMessage(msgEl, '最多只能选 ' + maxEvents + ' 项', 'error', 3000);
        }
        document.getElementById('selectedCount').textContent = eventList.querySelectorAll('input[name="events"]:checked').length;
      });

      var isOpen = data.registration_open;
      banner.className = 'banner ' + (isOpen ? 'banner-success' : 'banner-error');
      banner.textContent = isOpen ? '报名进行中' : '报名已截止';
      submitBtn.disabled = !isOpen;
      if (!isOpen) form.classList.add('form-locked');

      var lastStu = localStorage.getItem('last_student_name');
      if (lastStu) document.getElementById('name').value = lastStu;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var events = Array.prototype.map.call(eventList.querySelectorAll('input[name="events"]:checked'), i => i.value);
      var gender = form.querySelector('input[name="gender"]:checked');
      var name = document.getElementById('name').value.trim();
      
      if (!name) return setMessage(msgEl, '请填写姓名', 'error', 3000);
      if (!gender) return setMessage(msgEl, '请选择性别', 'error', 3000);
      if (!events.length) return setMessage(msgEl, '请选择项目', 'error', 3000);

      submitBtn.disabled = true; submitBtn.textContent = '提交中...';
      requestJSON('/api/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department: deptSelect.value, class_name: classSelect.value, name: name, gender: gender.value, events: events })
      }).then(data => {
        localStorage.setItem('last_student_name', name);
        msgEl.className = 'message success';
        msgEl.innerHTML = data.message + ' <button class="btn-revoke" id="revokeBtn">撤回</button>';
        document.getElementById('revokeBtn').onclick = function() {
          requestJSON('/api/revoke', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({id: data.id, class_name: data.record.class_name, name: data.record.name}) })
          .then(() => { msgEl.style.display='none'; form.reset(); });
        };
        setTimeout(() => msgEl.style.display = 'none', 30000);
        form.reset(); document.getElementById('name').value = name; document.getElementById('selectedCount').textContent = '0';
      }).catch(err => setMessage(msgEl, err.message, 'error', 5000))
        .finally(() => { submitBtn.disabled = false; submitBtn.textContent = '提 交 报 名'; });
    });
  }

  /* 查询页 */
  function initQueryPage() {
    var qDept = document.getElementById('qDept'), qClass = document.getElementById('qClass'), msg = document.getElementById('message');
    requestJSON('/api/meta').then(data => fillDeptAndClass(qDept, qClass, data.departments, data.classes_by_department));
    
    document.getElementById('queryBtn').onclick = function(){
      var cls = qClass.value, nm = document.getElementById('qName').value.trim();
      if(!cls || !nm) return setMessage(msg, '请填写完整', 'error');
      requestJSON('/api/query?class_name='+encodeURIComponent(cls)+'&name='+encodeURIComponent(nm)).then(data => {
        document.getElementById('resultBox').style.display = 'block';
        document.getElementById('resultBody').innerHTML = `
          <div class="query-result-card">
            <div>班级：${data.record.class_name}</div><div>姓名：${data.record.name}</div><div>项目：${data.record.events}</div>
          </div>`;
      }).catch(e => setMessage(msg, e.message, 'error'));
    };
  }

  /* 后台 */
  function initAdminPage() {
    var loginView = document.getElementById('loginView'), adminView = document.getElementById('adminView');
    var pwdModal = document.getElementById('pwdModal');

    document.getElementById('loginForm').onsubmit = function(e) {
      e.preventDefault();
      requestJSON('/api/admin/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({password: document.getElementById('loginPass').value}) })
      .then(data => {
        loginView.style.display = 'none';
        if (data.need_change_pwd) {
          pwdModal.style.display = 'flex'; // 强制弹窗
        } else {
          initAdminUI();
        }
      }).catch(e => setMessage(document.getElementById('loginMessage'), e.message, 'error'));
    };

    // 强制改密逻辑
    document.getElementById('doChangePwdBtn').onclick = function() {
      var np = document.getElementById('newPwdInput').value;
      if (np.length < 6) {
        var msgEl = document.getElementById('pwdMsg');
        msgEl.textContent = '密码至少6位'; msgEl.style.display = 'block'; return;
      }
      requestJSON('/api/admin/change_pwd', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({new_password: np}) })
      .then(() => {
        alert('密码修改成功，请重新登录！');
        location.reload();
      });
    };

    function initAdminUI() {
      loginView.style.display = 'none'; adminView.style.display = 'block';
      document.querySelectorAll('.tab').forEach(t => {
        t.onclick = function(){
          document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
          document.querySelectorAll('.tab-panel').forEach(x => x.hidden = true);
          this.classList.add('active'); document.querySelector(`.tab-panel[data-panel="${this.dataset.tab}"]`).hidden = false;
          if(this.dataset.tab === 'logs') loadLogs();
        };
      });
      document.getElementById('logoutBtn').onclick = () => requestJSON('/api/admin/logout', {method:'POST'}).then(()=> location.reload());
      loadAllData();
    }

    function loadAllData() {
      requestJSON('/api/admin/data').then(data => {
        document.getElementById('statsBox').innerHTML = `
          <div class="stat-card"><div class="stat-value">${data.total}</div><div class="stat-label">总人数</div></div>
          <div class="stat-card"><div class="stat-value">${data.stats.by_gender['男']||0}</div><div class="stat-label">男生</div></div>
          <div class="stat-card"><div class="stat-value">${data.stats.by_gender['女']||0}</div><div class="stat-label">女生</div></div>`;
        
        function drawPie(el, list) {
          var total = list.reduce((s,d)=>s+d.value,0); if(!total) return el.innerHTML='无数据';
          var cx=80, cy=80, r=70, angle=-Math.PI/2, paths='', legend='', colors=['#2563eb','#16a34a','#f59e0b','#ef4444','#8b5cf6'];
          list.forEach((d,i)=>{
            if(!d.value) return;
            var ratio = d.value/total, end = angle + ratio*Math.PI*2, large = ratio>0.5?1:0, c = colors[i%colors.length];
            paths += `<path d="M${cx},${cy} L${cx+r*Math.cos(angle)},${cy+r*Math.sin(angle)} A${r},${r} 0 ${large},1 ${cx+r*Math.cos(end)},${cy+r*Math.sin(end)} Z" fill="${c}" stroke="#fff"></path>`;
            legend += `<li><span class="legend-dot" style="background:${c}"></span>${d.label} <b>${d.value}</b></li>`;
            angle = end;
          });
          el.innerHTML = `<div class="pie-chart-wrap"><svg viewBox="0 0 160 160" class="pie-chart">${paths}</svg><ul class="pie-legend">${legend}</ul></div>`;
        }
        drawPie(document.getElementById('pieEvent'), data.stats.by_event_sorted.map(x=>({label:x[0],value:x[1]})));
        drawPie(document.getElementById('pieDept'), Object.keys(data.stats.by_department).map(k=>({label:k,value:data.stats.by_department[k]})));

        allRecords = data.records; renderTable();

        document.getElementById('setMaxEvents').value = data.max_events;
        document.getElementById('setNotice').value = data.notice;
        var btnToggle = document.getElementById('toggleRegBtn');
        btnToggle.textContent = data.registration_open ? '关闭报名' : '开启报名';
        btnToggle.onclick = () => requestJSON('/api/admin/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ registration_open: !data.registration_open }) }).then(()=> loadAllData());

        var projBox = document.getElementById('projList'); projBox.innerHTML = '';
        data.projects.forEach(p => projBox.innerHTML += `<div class="project-item"><span>${p}</span><button class="btn-tiny" style="color:red" onclick="delProj('${p}')">删除</button></div>`);
      });
    }

    function renderTable() {
      var tbody = document.getElementById('tableBody'); tbody.innerHTML = ''; selectedIds = {};
      var start = (currentPage-1)*pageSize, pageData = allRecords.slice(start, start+pageSize);
      if(!pageData.length) return tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">无数据</td></tr>';
      pageData.forEach((r, i) => {
        tbody.innerHTML += `<tr>
          <td><input type="checkbox" data-id="${r.id}" onchange="toggleSelect(this)"></td>
          <td>${start+i+1}</td><td>${r.department}</td><td>${r.class_name}</td><td>${r.name}</td><td>${r.gender}</td>
          <td>${r.events.replace(/,/g,'、')}</td><td>${r.created_at}</td>
          <td><button class="btn-tiny" onclick="window.printClass('${r.class_name}')">打印</button><button class="btn-tiny" style="color:red" onclick="delRec(${r.id})">删</button></td>
        </tr>`;
      });
      var totalPages = Math.ceil(allRecords.length / pageSize), div = document.getElementById('pagination'); div.innerHTML = '';
      for(let i=1; i<=totalPages; i++) div.innerHTML += `<button class="page-btn ${i===currentPage?'active':''}" onclick="window.goPage(${i})">${i}</button>`;
    }

    window.goPage = i => { currentPage = i; renderTable(); };
    window.toggleSelect = cb => { if(cb.checked) selectedIds[cb.dataset.id]=true; else delete selectedIds[cb.dataset.id]; document.getElementById('batchDeleteBtn').disabled = Object.keys(selectedIds).length===0; };
    window.delRec = id => { if(confirm('确定删除?')) requestJSON('/api/admin/delete_record', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id}) }).then(()=> loadAllData()); };
    window.delProj = name => { if(confirm('确定删除项目?')) requestJSON('/api/admin/projects', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name}) }).then(()=> loadAllData()); };
    window.printClass = c => window.open('/print/' + encodeURIComponent(c), '_blank');

    document.getElementById('batchDeleteBtn').onclick = () => {
      var ids = Object.keys(selectedIds); if(!confirm('删除选中的 ' + ids.length + ' 条?')) return;
      Promise.all(ids.map(id => requestJSON('/api/admin/delete_record', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id}) }))).then(()=> loadAllData());
    };
    document.getElementById('clearAllBtn').onclick = () => {
      if(prompt('危险操作！请输入 "清空" 确认：') === '清空') requestJSON('/api/admin/clear_data', {method:'POST'}).then(()=> loadAllData());
    };
    document.getElementById('saveMaxEventsBtn').onclick = () => requestJSON('/api/admin/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({max_events: document.getElementById('setMaxEvents').value}) }).then(()=> alert('保存成功'));
    document.getElementById('saveNoticeBtn').onclick = () => requestJSON('/api/admin/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({registration_notice: document.getElementById('setNotice').value}) }).then(()=> alert('保存成功'));
    document.getElementById('addProjBtn').onclick = () => requestJSON('/api/admin/projects', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name: document.getElementById('newProjName').value}) }).then(()=> { document.getElementById('newProjName').value=''; loadAllData(); });
    document.getElementById('exportBtn').onclick = () => window.location.href = '/api/export';

    function loadLogs() {
      requestJSON('/api/admin/logs').then(data => {
        var tb = document.getElementById('logBody'); tb.innerHTML = '';
        data.logs.forEach(l => tb.innerHTML += `<tr><td>${l.created_at}</td><td>${l.action}</td><td>${l.detail}</td></tr>`);
      });
    }

    requestJSON('/api/admin/session').then(data => { if(data.logged_in) initAdminUI(); else loginView.style.display = 'flex'; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('regForm')) initRegisterPage();
    if (document.getElementById('queryBtn')) initQueryPage();
    if (document.getElementById('loginView')) initAdminPage();
  });
})();