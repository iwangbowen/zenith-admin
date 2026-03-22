const icons = require('@douyinfe/semi-icons');
const needed = ['IconTreeSelect', 'IconIdCard', 'IconBookOpen', 'IconFile', 'IconGridView', 'IconHome', 'IconSetting', 'IconUser', 'IconUpload', 'IconMenu'];
needed.forEach(n => console.log(n, !!icons[n]));
