// Theme toggle.
// The light (day) theme is the default. The switch in the sidebar footer
// toggles a `day` class on <body>: checked = day (light), unchecked = dark.
// The choice is remembered in the same localStorage settings blob.
function nightDayHandler(target){
    var isDay = target.checked;
    document.body.classList.toggle('day', isDay);
    try{
        var s = JSON.parse(localStorage.getItem('wikiSettings')) || {};
        s.theme = isDay ? 'day' : 'night';
        localStorage.setItem('wikiSettings', JSON.stringify(s));
    }catch(e){}
}
