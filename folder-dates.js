// folder-dates.js — 폴더 모아보기 목차에 git 이력 기반 생성일자를 표시.
// app.js의 기존 showFolder 동작은 그대로 두고, 렌더 직후 비동기로 날짜만 보강한다.
(function(){
    'use strict';

    function folderSectionFromHash(){
        var raw = location.hash || '';
        if(raw.indexOf('#!folder:') !== 0){ return ''; }
        try{ return decodeURIComponent(raw.slice(9)); }
        catch(e){ return ''; }
    }

    function hydrateFolderTocDates(section){
        var toc = document.querySelector('#article .folder-toc');
        var docs = (window.FOLDER_DOCS && FOLDER_DOCS[section]) || [];
        if(!toc || !docs.length || !window.App || !App.data || !App.data.loadDates){ return; }

        App.data.loadDates().then(function(dd){
            // 사용자가 그 사이 다른 화면으로 이동했으면 늦은 응답을 버린다.
            if(document.querySelector('#article .folder-toc') !== toc){ return; }
            var rows = toc.querySelectorAll('li');
            docs.forEach(function(doc, i){
                var row = rows[i];
                var rec = dd && dd.docs && dd.docs[doc.name];
                var date = rec && typeof formatDocDate === 'function' ? formatDocDate(rec.c) : '';
                if(!row || !date || row.querySelector('.folder-toc-date')){ return; }
                var span = document.createElement('span');
                span.className = 'folder-toc-date';
                span.textContent = STR('dateCreated') + ' ' + date;
                row.appendChild(span);
            });
        }).catch(function(){
            // 날짜 메타데이터 실패는 모아보기 자체를 막지 않는다.
        });
    }

    var originalShowFolder = window.showFolder;
    if(typeof originalShowFolder === 'function'){
        window.showFolder = function(section){
            originalShowFolder(section);
            hydrateFolderTocDates(section);
        };
    }

    // app.js 부트가 먼저 초기 라우트를 그렸을 수 있으므로 최초 화면도 한 번 보강.
    var initialSection = folderSectionFromHash();
    if(initialSection){ hydrateFolderTocDates(initialSection); }
})();
