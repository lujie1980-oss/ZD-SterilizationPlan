<script setup lang="ts">
import { PROCESSES } from '../../data/seed-processes';
</script>

<template>
  <section id="page-processes" class="page active">
    <div class="card">
      <div class="card-header">
        <span>工艺与指定柜</span>
        <span class="tag tag-pending">亚澳 / EO通用 规则待确认</span>
      </div>
      <div class="card-body table-wrap" style="padding:0">
        <table class="data">
          <thead>
            <tr><th>工艺代码</th><th>名称</th><th>允许灭菌柜</th><th>解析天数</th><th>说明</th></tr>
          </thead>
          <tbody id="procBody">
            <tr v-for="p in PROCESSES" :key="p.code">
              <td><strong>{{ p.code }}</strong> <span v-if="p.pending" class="tag tag-pending">待确认</span></td>
              <td>{{ p.name }}</td>
              <td><span v-for="c in p.cabinets" :key="c" class="tag tag-default">{{ c }}</span></td>
              <td>{{ p.aerateDays }}d <span v-if="!p.aerateConfirmed" class="tag tag-pending">解析待确认</span></td>
              <td>{{ p.note || '—' }} <span v-if="p.pending" class="tag tag-pending">规则待确认</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
