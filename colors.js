var Links = {
    setColor:function(color){
        //1. javaScript
        // var vlist = document.querySelectorAll('a');
        // var i=0;
        // while(i < vlist.length){
        //         vlist[i].style.color = color;
        //         i++;
        // }//while()

        //2. jQuery
        $('a').css('color', color);
    }
}

var Body = {
    setColor:function (color){
        document.querySelector('body').style.color = color;
    },
    setBG_Color:function (color){
        document.querySelector('body').style.backgroundColor = color;
    }
}

function nightDayHandler(slef){
    if(slef.value === 'night'){
        Body.setBG_Color('black');
        Body.setColor('white');
        slef.value = 'day';
        Links.setColor('powderblue');
    } else {
        Body.setBG_Color('white');
        Body.setColor('black');
        slef.value = 'night';
        Links.setColor('tomato');
    }//if()
}