// Theme toggle.
// The dark theme is the default (defined in style.css). Clicking the footer
// button toggles a `day` class on <body>, which switches to the light theme.
function nightDayHandler(target){
    var body = document.querySelector('body');
    if(target.value === 'day'){
        body.classList.add('day');
        target.value = 'night';
    } else {
        body.classList.remove('day');
        target.value = 'day';
    }
}
