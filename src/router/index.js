import Vue from 'vue';
import Router from 'vue-router';
import Meta from 'vue-meta';
import index from '../views/index';
import transfer from "../views/transfer";
import test from "../views/test";

Vue.use(Router);
Vue.use(Meta);
let router = new Router({
    // 设置history以便开启预渲染
    mode: 'history',
    routes: [{
        path: '/',
        component: index,
        name: 'index'
    }, {
        path: '/transfer',
        component: transfer,
        name: 'transfer'
    }, {
        path: '/test',
        component: test,
        name: 'test'
    }
    ]
});
router.beforeEach((to, from, next) => {
    next();
});
export default router;