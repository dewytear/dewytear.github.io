var Links = {
    setColor:function(color){
        var vlist = document.querySelectorAll('a');
        var i=0;
        while(i < vlist.length){
                vlist[i].style.color = color;
                i++;
        }//while()
    }
}

var Body = {
    setColor:function (color){
        document.querySelector('body').style.color = color;
    },
    setBGColor:function (color){
        document.querySelector('body').style.backgroundColor = color;
    }
}

function nightDayHandler(slef){
    if(slef.value === 'night'){
        Body.setBGColor('black');
        Body.setColor('white');
        slef.value = 'day';
        Links.setColor('powderblue');
    } else {
        Body.setBGColor('white');
        Body.setColor('black');
        slef.value = 'night';
        Links.setColor('tomato');
    }//if()
}