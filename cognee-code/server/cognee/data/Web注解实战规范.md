# Type-CRM Web 注解实战规范

> 专注于实战场景、边界案例和常见错误

## 🎯 核心规则速查

### **规则 1: 标准 CRUD 无需显式注解**

| **场景** | **URL 模式**                     | **HTTP** | **注解**  | **JS 函数** |
| -------- | -------------------------------- | -------- | --------- | ----------- |
| 标准查询 | `/api/data/object/{apiKey}`      | POST     | ❌ 不需要 | `List()`    |
| 查看详情 | `/api/data/object/{apiKey}/{id}` | GET      | ❌ 不需要 | `View()`    |
| 创建记录 | `/api/data/object/{apiKey}`      | PUT      | ❌ 不需要 | `Create()`  |
| 编辑记录 | `/api/data/object/{apiKey}/{id}` | PATCH    | ❌ 不需要 | `Edit()`    |
| 删除记录 | `/api/data/object/{apiKey}/{id}` | DELETE   | ❌ 不需要 | `Delete()`  |

### **规则 2: 何时需要显式注解**

| **场景**               | **使用注解**                              | **必填参数**          |
| ---------------------- | ----------------------------------------- | --------------------- |
| 同一实体的多个查询接口 | `@Query(funcName = "...")`                | `funcName`            |
| 同一实体的多个详情接口 | `@View(funcName = "...")`                 | `funcName`            |
| 同一实体的多个编辑接口 | `@Edit(funcName = "...")`                 | `funcName`            |
| 自定义业务逻辑         | `@Call(apiKey = "...", funcName = "...")` | `apiKey` + `funcName` |

---

## 📚 实战示例库

### **场景 1: 多查询接口 - @Query**

#### **示例 1: 关联列表查询**

```java
@PostMapping("/api/data/object/{apiKey}")
@PreAuthorize("hasPermission(#apiKey, 'list')")
@Query(funcName = "RelationList")  // 显式指定 funcName
public Either<Code, Tuple2<Page<Map<String, Object>>, Map<String, Object>>> queryRelationList(
    Authentication authentication,
    @PathVariable String apiKey,
    BeanType<EntityBean> desc,
    @RequestParam(required = false) Long pageId,
    @Validated QueryForm queryMap) {
    return doQueryPage(authentication, apiKey, "RelationList", desc, pageId, queryMap);
}
```

对应 JavaScript 配置：

```javascript
const RelationList = () => {
  return {
    query: {
      columns: [{ name: "parentId", rule: required }], // 必填的关联查询参数
    },
    table: [
      { name: "id", label: "ID" },
      { name: "name", label: "名称" },
    ],
  };
};
```

#### **示例 2: 树形查询**

```java
@PostMapping("/api/data/object/regional/tree")
@Query(apiKey = "regional", funcName = "Tree")  // apiKey 和 funcName 都指定
@PreAuthorize("hasPermission('regional', 'list')")
public Either<Code, List<Map<String, Object>>> tree(
    Authentication authentication,
    BeanType<Regional> desc,
    Model model,
    @RequestBody(required = false) QueryForm queryForm) {

    Either<Code, Slice<Regional>> slice = ebeanApi.querySlice(desc, queryForm.getQuery(), PageRequest.ofSize(1000));
    if (slice.isLeft()) {
        return Either.left(slice.getLeft());
    }
    return Either.right(treeService.toTree(Regional.class, slice.get().getContent(), desc.property("parentRegional"), bean -> {
        return ebeanApi.toJSON(model, desc, bean);
    }));
}
```

对应 JavaScript 配置：

```javascript
const Tree = () => {
  return {
    query: {
      columns: [{ name: "regionalModel", op: "eq", rule: required }],
    },
    table: {
      columns: [
        { name: "id", label: "ID" },
        { name: "name", label: "区域名称" },
        { name: "parentRegional", label: "上级区域" },
      ],
    },
  };
};
```

### **场景 2: 多详情接口 - @View**

#### **示例: 编辑表单详情**

```java
@GetMapping("/api/data/object/{apiKey}/{id}")
@PreAuthorize("hasPermission(#apiKey, 'edit')")
@View(funcName = "Edit")  // 获取编辑表单所需的详情数据
public Either<Code, Map<String, Object>> getEditView(
    Authentication authentication,
    BeanType<EntityBean> desc,
    @PathVariable String apiKey,
    @PathVariable String id,
    @RequestParam(required = false) Long pageId) {

    Either<Code, Model> modelE = metadataService.getView(authentication, apiKey, "Edit", pageId);
    if (modelE.isLeft()) {
        return (Either) modelE;
    }
    Model model = modelE.get();
    Expression dataPermission = model.getDataPermissionWhere(authenticationService.filter(desc));
    return dataService.fetchDetail(desc, id, model, dataPermission);
}
```

对应 JavaScript 配置：

```javascript
const Edit = () => {
  return {
    form: [
      { name: "name", rule: required.and(length(2, 64)) },
      { name: "status", rule: number },
    ],
    view: [
      { name: "id", label: "ID" },
      { name: "name", label: "名称" },
      { name: "status", label: "状态" },
    ],
  };
};
```

### **场景 3: 多编辑接口 - @Edit**

#### **示例 1: 编辑不同实体**

```java
@PatchMapping("/api/data/object/regional/model/{id}")
@Edit(apiKey = "regional", funcName = "EditModel")  // 编辑 RegionalModel
@PreAuthorize("hasPermission('regionalModel', 'edit')")
public Either<Code, Map<String, Object>> patchModel(
    Authentication authentication,
    BeanType<RegionalModel> desc,  // ⚠️ 注意: 实体类型根据业务需求可以不同
    Model model,
    @PathVariable Long id,
    @RequestBody JSONObject body) {

    Expression dataPermission = model.getDataPermissionWhere(authenticationService.filter(desc));
    return dataService.patch(desc, String.valueOf(id), body, model, dataPermission);
}
```

对应 JavaScript 配置（regional.js）：

```javascript
const EditModel = () => {
  return {
    form: [
      { name: "name", rule: required.and(length(2, 64)) },
      { name: "description", rule: optional },
      { name: "status", rule: number },
    ],
  };
};
```

#### **示例 2: 部分字段更新**

```java
@PatchMapping("/api/data/object/regional/model/entity/{id}")
@Edit(apiKey = "regional", funcName = "UpdateModelEntity")
@PreAuthorize("hasPermission('regionalModel', 'edit')")
public Either<Code, Map<String, Object>> updateModelEntity(
    Authentication authentication,
    BeanType<RegionalModelEntity> desc,
    Model model,
    @PathVariable Long id,
    @RequestBody JSONObject body) {

    return dataService.patch(desc, String.valueOf(id), body, model);
}
```

对应 JavaScript 配置：

```javascript
const UpdateModelEntity = () => {
  return {
    form: [
      { name: "enabled", rule: optional },
      { name: "autoAssignOnCreate", rule: optional },
      { name: "autoAssignOnEdit", rule: optional },
    ],
  };
};
```

### **场景 4: 自定义业务 - @Call**

#### **示例: 根据 code 查询模型详情**

```java
@PostMapping("/api/data/object/regional/model")
@Call(apiKey = "regional", funcName = "ViewModel")  // 必须指定 funcName
@PreAuthorize("hasPermission('regionalModel', 'view')")
public Either<Code, Map<String, Object>> queryModel(
    Authentication authentication,
    Model model,
    @RequestBody Map<String, Object> body) {

    // 手动验证输入参数
    var error = model.validate(body);
    if (error.isDefined()) {
        return Either.left(Code.INVALID_ARGUMENT.withErrors(error));
    }

    // 自定义业务逻辑
    BeanType<RegionalModel> desc = ebeanApi.desc(RegionalModel.class);
    String code = TypeUtils.castToString(body.get("code"));
    Expression where = ebeanApi.expr().eq("code", code);

    return dataService.fetchWhere(desc, where, model.getView().get());
}
```

对应 JavaScript 配置：

```javascript
const ViewModel = () => {
  return {
    form: [
      {
        name: "code",
        rule: required, // 输入参数验证
      },
    ],
    view: [
      { name: "id", label: "ID" },
      { name: "name", label: "模型名称" },
      { name: "description", label: "描述" },
      {
        name: "entities",
        label: "实体配置",
        rule: array,
        columns: [
          { name: "entity", label: "实体名称" },
          { name: "enabled", label: "是否启用" },
          { name: "autoAssignOnCreate", label: "创建后分配" },
        ],
      },
    ],
  };
};
```

---

## ⚠️ 边界案例

### **案例 1: BeanType 参数注入的边界场景**

#### **场景 1: apiKey 与实体类型一致（自动注入）**

Spring 会自动根据 `apiKey` 注入 `BeanType` 参数：

```java
// ✅ 自动注入: apiKey = "regional" 自动注入 Regional 的 BeanType
@PostMapping("/api/data/object/{apiKey}")
public Either<Code, Page<Map<String, Object>>> query(
    @PathVariable String apiKey,
    BeanType<EntityBean> desc  // 自动注入（根据 apiKey 解析）
) {
    // 直接使用 desc
}
```

#### **场景 2: apiKey 与实体类型不一致（手动获取）**

当注解的 `apiKey` 与实际操作的实体类型不一致时，**必须手动获取正确的 BeanType**：

```java
// ✅ 正确: 手动获取 BeanType（RegionalAction 示例）
@PatchMapping("/api/data/object/regional/model/entity/{id}")
@Edit(apiKey = "regional", funcName = "UpdateModelEntity")
@PreAuthorize("hasPermission('regionalModel', 'edit')")
public Either<Code, Map<String, Object>> UpdateModelEntity(
    Authentication authentication,
    Model model,
    @PathVariable Long id,
    @RequestBody JSONObject body) {

    // apiKey = "regional"，但实际操作的是 RegionalModelEntity
    // 必须手动获取正确的 BeanType
    BeanType<RegionalModelEntity> desc = ebeanApi.desc(RegionalModelEntity.class);

    return dataService.patch(desc, String.valueOf(id), body, model);
}
```

**原因**：

- 注解的 `apiKey = "regional"` 用于获取 JavaScript 配置（`regional.js` 中的 `UpdateModelEntity()` 函数）
- 但实际操作的数据库表对应的是 `RegionalModelEntity` 实体
- Spring 自动注入的 `BeanType` 是根据 `apiKey` 解析的，会注入错误的类型
- 因此需要手动调用 `ebeanApi.desc(RegionalModelEntity.class)` 获取正确的 `BeanType`

**判断标准**：

- **apiKey 对应的实体 = 实际操作的实体** → 使用自动注入的 `BeanType` 参数
- **apiKey 对应的实体 ≠ 实际操作的实体** → 手动获取 `BeanType`

---

## 🌐 前端调用规范

### **QueryPredicate 格式要求**

前端调用查询接口时，必须按照 `QueryPredicate` 格式传递参数：

#### **基础查询格式**

```typescript
{
  query: {
    predicate: [
      {
        name: '字段名',      // 字段名称
        op: '操作符',        // 查询操作符（eq, contains, ge, le 等）
        value: [值数组]      // 必须是数组格式，即使是单个值
      }
    ]
  },
  page: 0,    // 页码（后端从 0 开始）
  size: 20    // 每页数量
}
```

#### **示例 1: 单条件查询**

```typescript
import { apiPost } from "src/api/api-client";

// 查询 status = 1 的记录
const result = await apiPost<Page<Map<string, any>>>(
  "/api/data/object/regional",
  {
    query: {
      predicate: [
        {
          name: "status",
          op: "eq",
          value: [1], // ⚠️ 必须是数组
        },
      ],
    },
    page: 0,
    size: 20,
  }
);
```

#### **示例 2: 多条件查询**

```typescript
// 查询 status = 1 且 name 包含 "测试" 且 createdAt >= "2024-01-01" 的记录
const result = await apiPost<Page<Map<string, any>>>(
  "/api/data/object/regional",
  {
    query: {
      predicate: [
        { name: "status", op: "eq", value: [1] },
        { name: "name", op: "contains", value: ["测试"] },
        { name: "createdAt", op: "ge", value: ["2024-01-01"] },
      ],
    },
    page: 0,
    size: 20,
  }
);
```

#### **示例 3: 带 funcName 的自定义查询**

```typescript
// 调用 Tree() 函数的查询接口
const treeResult = await apiPost<TreeNode[]>(
  "/api/data/object/regional/tree",
  {
    query: {
      predicate: [{ name: "regionalModel", op: "eq", value: [1] }],
    },
  },
  { funcName: "Tree" } // 第三个参数指定 funcName
);
```

### **自定义接口调用(@Call)**

```typescript
// 调用自定义业务逻辑接口
const result = await apiPost<Map<string, any>>(
  "/api/data/object/regional/model",
  { code: "region-model-001" }, // 传递 form 验证参数
  { funcName: "ViewModel" } // 指定 funcName
);
```

### **常见前端错误**

#### **错误 1: value 不是数组**

```typescript
// ❌ 错误
{
  name: "status",
  op: "eq",
  value: 1  // 错误: 不是数组
}

// ✅ 正确
{
  name: "status",
  op: "eq",
  value: [1]  // 正确: 数组格式
}
```

#### **错误 2: 直接传递查询参数而非 predicate 格式**

```typescript
// ❌ 错误
body.query = { status: 1, name: "测试" };

// ✅ 正确
body.query = {
  predicate: [
    { name: "status", op: "eq", value: [1] },
    { name: "name", op: "contains", value: ["测试"] },
  ],
};
```

#### **错误 3: funcName 不匹配**

```typescript
// ❌ 错误: 与后端 funcName 不一致
await apiPost("/api/data/object/regional/tree", body, { funcName: "TreeView" });

// ✅ 正确: 与后端 @Query(funcName = "Tree") 一致
await apiPost("/api/data/object/regional/tree", body, { funcName: "Tree" });
```

#### **错误 4: 分页索引从 1 开始**

```typescript
// ❌ 错误: 后端分页从 0 开始
{
  page: 1,  // 错误: 这是第二页
  size: 20
}

// ✅ 正确: 第一页从 0 开始
{
  page: 0,  // 正确: 第一页
  size: 20
}
```

---

## ⚠️ 常见错误

### **错误 1: funcName 不匹配**

```java
// ❌ 后端
@Query(apiKey = "regional", funcName = "Tree")
```

```typescript
// ❌ 前端
{
  funcName: "TreeView";
} // 错误: 函数名不匹配
```

**解决方案**:

```typescript
// ✅ 前端
{
  funcName: "Tree";
} // 与后端保持一致
```

### **错误 2: @Call 未指定 funcName**

```java
// ❌ 错误
@Call(apiKey = "regional")  // 缺少 funcName
```

**解决方案**:

```java
// ✅ 正确
@Call(apiKey = "regional", funcName = "ViewModel")
```

### **错误 3: 标准 CRUD 接口添加了不必要的注解**

```java
// ❌ 不必要的注解
@PostMapping("/api/data/object/{apiKey}")
@Query(apiKey = "regional")  // 不需要显式注解
public Either<Code, Page<Map<String, Object>>> query(...) {
```

**解决方案**:

```java
// ✅ 正确: 移除注解
@PostMapping("/api/data/object/{apiKey}")
public Either<Code, Page<Map<String, Object>>> query(...) {
```

### **错误 4: JavaScript 函数未定义**

```java
@Query(apiKey = "regional", funcName = "TreeList")  // JS 中不存在 TreeList()
```

**解决方案**:
在 `regional.js` 中添加对应函数：

```javascript
const TreeList = () => {
  return {
    table: [...]
  };
};
```
