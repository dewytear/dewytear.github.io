// Theme toggle.
// The dark theme is the default (defined in style.css). The switch in the
// sidebar footer toggles a `day` class on <body>: checked = day (light).
function nightDayHandler(target){
    document.body.classList.toggle('day', target.checked);
}
