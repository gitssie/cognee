/**
 * Quasar boot file: axios
 *
 * 全局 axios 配置：
 * - baseURL='/'  所有请求走同源，dev proxy / nginx 负责转发
 * - withCredentials 自动携带 auth cookie
 */

import { defineBoot } from '#q-app/wrappers';
import axios from 'axios';

export default defineBoot(() => {
  // 所有 API 请求走同源相对路径，dev proxy / production nginx 负责转发
  axios.defaults.baseURL = '/';
  axios.defaults.withCredentials = true;
});
