# DataService 使用文档

## 概述

`DataService` 是 Type-CRM 系统中的**高级业务数据访问服务**,提供带有模型验证和权限控制的 CRUD 操作。它封装了 EbeanApi 的底层数据访问,提供统一的业务接口。

**核心特性**:

- 元数据驱动的参数验证
- 自动应用数据权限
- Either 错误处理模式
- 统一返回 Map<String, Object>
- 事务自动管理

## 核心方法速查表

| 方法分类   | 方法名            | 用途               | 返回类型                                   | 事务 |
| ---------- | ----------------- | ------------------ | ------------------------------------------ | ---- |
| **创建**   | `create`          | 创建单个实体       | `Either<Code, Map<String, Object>>`        | ✅   |
|            | `batchSave`       | 批量创建实体       | `Either<Code, List<Map<String, Object>>>`  | ✅   |
| **更新**   | `patch`           | 更新单个实体       | `Either<Code, Map<String, Object>>`        | ✅   |
|            | `batchPatch`      | 批量更新实体       | `Either<Code, List<Map<String, Object>>>`  | ✅   |
| **删除**   | `delete`          | 删除单个实体       | `Either<Code, Map<String, Object>>`        | ✅   |
|            | `batchDelete`     | 批量删除实体       | `Either<Code, List<Map<String, Object>>>`  | ✅   |
| **查询**   | `fetchDetail`     | 查询单个实体详情   | `Either<Code, Map<String, Object>>`        | 只读 |
|            | `fetchDetailList` | 查询多个实体详情   | `Either<Code, List<Map<String, Object>>>`  | 只读 |
|            | `fetchWhere`      | 按条件查询单个实体 | `Either<Code, Map<String, Object>>`        | 只读 |
|            | `queryMap`        | 分页查询实体列表   | `Either<Code, Page<Map<String, Object>>>`  | 只读 |
|            | `queryMapSlice`   | Slice 分页查询     | `Either<Code, Slice<Map<String, Object>>>` | 只读 |
|            | `queryCount`      | 查询总数           | `Either<Code, Integer>`                    | 只读 |
| **Upsert** | `restSave`        | 单个 Upsert        | `Either<Code, Map<String, Object>>`        | ✅   |
|            | `restBatchSave`   | 批量 Upsert        | `Either<Code, List<Map<String, Object>>>`  | ✅   |
|            | `restPatch`       | 只更新(不创建)     | `Either<Code, Map<String, Object>>`        | ✅   |
|            | `restBatchPatch`  | 批量只更新         | `Either<Code, List<Map<String, Object>>>`  | ✅   |

## 一、创建操作

### 1.1 create() - 创建单个实体

**方法签名**:

```java
public <T> Either<Code, Map<String, Object>> create(
    BeanType<T> desc,          // 实体类型描述
    Map<String, Object> body,  // 实体数据
    Model model                // 元数据模型
)
```

**参数说明**:

- `desc`: 实体类型描述符,通过 `ebeanApi.desc(EntityClass.class)` 获取
- `body`: 实体数据 Map,包含要创建的实体属性
- `model`: 元数据模型,包含字段定义和验证规则

**返回值**:

- **成功**: `Either.right(Map)`,包含创建的实体 ID
- **失败**: `Either.left(Code)`,包含错误码和错误信息

**工作流程**:

1. 使用 Model 验证 body 数据(字段类型、必填、长度等)
2. 创建实体实例并设置属性
3. 执行数据库插入操作
4. 返回实体 ID

**返回值示例**:

```java
// 成功: Either.right({"id": 123})
// 失败: Either.left(Code.INVALID_ARGUMENT.withErrors(...))
```

### 1.2 batchSave() - 批量创建实体

**方法签名**:

```java
public Either<Code, List<Map<String, Object>>> batchSave(
    BeanType<?> desc,
    List<Map<String, Object>> body,
    Model model
)
```

**参数说明**:

- `body`: 实体数据列表,每个元素代表一个实体的数据

**返回值**:

- 返回列表,每个元素包含 `success`(布尔值)和 `id`(成功时)或 `message`(失败时)

**返回值示例**:

```java
// [
//   {"success": true, "id": 101},
//   {"success": true, "id": 102},
//   {"success": false, "message": "验证失败:名称不能为空"}
// ]
```

**关键特性**:

- 单个事务中执行所有插入操作
- 部分失败不影响其他成功的插入
- 每个实体独立验证

### 1.3 newBean() - 创建实体实例(不保存)

**方法签名**:

```java
public <T> Either<Code, T> newBean(
    BeanType<T> desc,
    Map<String, Object> body,
    Model model
)
```

**用途**: 仅创建实体实例并验证,不执行数据库保存操作

**返回值**: 返回实体实例或验证错误

**使用场景**: 需要在保存前对实体进行额外处理时使用

## 二、更新操作

### 2.1 patch() - 更新单个实体

**方法签名**:

````java
public <T> Either<Code, Map<String, Object>> patch(
    BeanType<?> desc,
    Object id,                      // 实体主键
    Map<String, Object> body,
    Model model,
    Expression dataPermission        // 数据权限表达式(可选)
### 2.1 patch() - 更新单个实体

**方法签名**:
```java
public <T> Either<Code, Map<String, Object>> patch(
    BeanType<?> desc,
    Object id,                      // 实体主键
    Map<String, Object> body,
    Model model,
    Expression dataPermission        // 数据权限表达式(可选)
)
````

**参数说明**:

- `id`: 实体主键
- `dataPermission`: 数据权限表达式,限制只能修改有权限的数据

**工作流程**:

1. 根据 ID 和数据权限查询实体
2. 如果实体不存在,返回 `Code.NOT_FOUND`
3. 使用 Model 验证 body 数据
4. 更新实体属性
5. 执行数据库更新操作
6. 返回实体 ID

**重载方法**:

```java
// 不使用数据权限
public <T> Either<Code, Map<String, Object>>> patch(
    BeanType<?> desc, Object id, Map<String, Object> body, Model model
)

// 使用已查询的实体实例
public <T> Either<Code, Map<String, Object>> patch(
    BeanType<?> desc, EntityBean bean, Map<String, Object> body, Model model
)
```

````

**参数说明**:
- `body`: 实体数据列表,**每个元素必须包含 `id` 字段**

**工作流程**:
1. 遍历 body 列表
2. 对每个元素:
   - 根据 `id` 查询实体
### 2.2 batchPatch() - 批量更新实体 ⭐

**方法签名**:
```java
public Either<Code, List<Map<String, Object>>> batchPatch(
    BeanType<?> desc,
    List<Map<String, Object>> body,
    Model model
)
````

**参数说明**:

- `body`: 实体数据列表,**每个元素必须包含 `id` 字段**

**工作流程**:

1. 遍历 body 列表
2. 对每个元素:
   - 根据 `id` 查询实体
   - 验证更新数据
   - 更新实体属性
   - 保存到数据库
3. 返回每个实体的更新结果

**返回值示例**:

```java
// [
//   {"success": true, "id": 101},
//   {"success": true, "id": 102}
// ]
```

**关键特性**:

- 每个实体独立验证和更新
- 部分失败不影响其他成功的更新
- 只更新 Model 中定义的字段

### 2.4 patchAssocAppend() - 追加关联实体

**方法签名**:

```java
public <T> Either<Code, Map<String, Object>> patchAssocAppend(
    BeanType<?> desc,
    Property property,
    Object id,
    Model model,
    Expression dataPermission,
    List<Map<String, Object>> body
)
```

**用途**: 向一对多关联中追加新的子实体(如为订单追加明细项)

**使用场景**: 动态扩展关联实体列表

## 三、删除操作

### 3.1 delete() - 删除单个实体

**方法签名**:

```java
public <T> Either<Code, Map<String, Object>> delete(
    BeanType<T> desc,
    Object id,
    Model model,
    Expression dataPermission
)
```

**工作流程**:

1. 根据 ID 和数据权限查询实体
2. 如果实体不存在,返回 `Code.NOT_FOUND`
3. 检查实体是否可以删除(如检查 `lockStatus`)

### 3.1 delete() - 删除单个实体

**方法签名**:

```java
public <T> Either<Code, Map<String, Object>> delete(
    BeanType<T> desc,
    Object id,
    Model model,
    Expression dataPermission
)
```

**工作流程**:

1. 根据 ID 和数据权限查询实体
2. 如果实体不存在,返回 `Code.NOT_FOUND`
3. 检查实体是否可以删除(如检查 `lockStatus`)
4. 执行数据库删除操作
5. 返回实体 ID

**删除规则**:

- 如果实体 `lockStatus = true`,返回 `Code.FAILED_PRECONDITION.withMessage("数据被锁定,无法删除")`
- 支持软删除(修改状态)或硬删除(物理删除)
  **返回值**:

### 3.2 batchDelete() - 批量删除实体

**方法签名**:

```java
public <T> Either<Code, List<Map<String, Object>>> batchDelete(
    BeanType<T> desc,
    List<String> idList,
    Model model,
    Expression dataPermission
)
```

**参数说明**:

- `idList`: 要删除的实体 ID 列表(字符串类型)

**返回值**:

- 返回列表,每个元素包含 `success`(布尔值)、`id` 和可能的 `message`

**返回值示例**:

```java
// [
//   {"success": true, "id": 101},
//   {"success": false, "message": "数据被锁定,无法删除", "id": 102},
//   {"success": true, "id": 103}
// ]
```

**关键特性**:

- 每个实体独立检查删除条件
- 锁定的实体跳过删除
- 部分失败不影响其他成功的删除

1. 根据 ID 和数据权限查询实体
2. 如果实体不存在,返回 `Code.NOT_FOUND`
3. 根据 Model 的 `view` 配置选择返回的字段

### 4.1 fetchDetail() - 查询单个实体详情

**方法签名**:

```java
public <T> Either<Code, Map<String, Object>> fetchDetail(
    BeanType<T> desc,
    Object id,
    Model model,
    Expression dataPermission
)
```

**工作流程**:

1. 根据 ID 和数据权限查询实体
2. 如果实体不存在,返回 `Code.NOT_FOUND`
3. 根据 Model 配置选择返回的字段
4. 将实体转换为 Map 并返回

**关键特性**:

- 根据 Model 配置过滤返回字段
- 自动处理关联实体的加载
- 支持嵌套对象的序列化
  **使用场景**: 批量查询多个实体的详细信息

### 4.3 fetchWhere() - 按条件查询单个实体

**方法签名**:

```java
public <T> Either<Code, Map<String, Object>> fetchWhere(
    BeanType<T> desc,
    Expression where,
    Model model
)
```

**参数说明**:

- `where`: 查询条件表达式

**使用场景**: 根据业务条件(非 ID)查询单个实体

**使用示例**:

```java
Expression where = ebeanApi.expr().eq("code", "EAST_CHINA");
return dataService.fetchWhere(desc, where, model);
```

### 4.4 queryMap() - 分页查询实体列表

**方法签名**:

````java
public <T> Either<Code, Page<Map<String, Object>>> queryMap(
    BeanType<T> desc,
    Model model,
    Expression dataPermission,
    QueryPredicate queryPredicate,
    Pageable page
### 4.3 fetchWhere() - 按条件查询单个实体

**方法签名**:
```java
public <T> Either<Code, Map<String, Object>> fetchWhere(
    BeanType<T> desc,
### 4.4 queryMap() - 分页查询实体列表

**方法签名**:
```java
public <T> Either<Code, Page<Map<String, Object>>> queryMap(
    BeanType<T> desc,
    Model model,
    Expression dataPermission,
    QueryPredicate queryPredicate,
    Pageable page
)
````

**参数说明**:

- `queryPredicate`: 查询谓词,包含查询条件
- `page`: 分页参数(页码、每页大小、排序)

**工作流程**:

1. 应用数据权限过滤
2. 应用查询条件
3. 应用分页和排序
4. 查询数据库
5. 根据 Model 配置选择返回的字段
6. 返回分页结果

**重载方法**:

````java
// 使用 Expression 作为查询条件
public <T> Page<Map<String, Object>> queryMap(
    BeanType<T> desc,
    Model model,
    Expression where,
    Pageable page
)

// 添加缓存支持
public <T> Either<Code, Page<Map<String, Object>>> queryMap(
    BeanType<T> desc,
    Model model,
    Expression dataPermission,
    QueryPredicate queryPredicate,
    Pageable page,
    Option<FetchCacheId> fetchCache
)
```lic <T> Either<Code, Integer> queryCount(
    BeanType<T> desc,
    Model model,
    Expression dataPermission,
    QueryPredicate queryPredicate
)
````

**用途**: 获取符合条件的记录总数

**使用场景**: 统计查询、数据校验

## 五、Upsert 操作

### 5.1 restSave() - 单个 Upsert

**方法签名**:

```java
public Either<Code, Map<String, Object>> restSave(
    BeanType<?> desc,
    Map<String, Object> body,
    Model model
)
```

**工作逻辑**:

- 如果 body 包含 `id` 字段且实体存在 → 更新
- 如果 body 不包含 `id` 字段或实体不存在 → 创建

**使用场景**: REST API 风格的保存操作

### 5.2 restBatchSave() - 批量 Upsert

**方法签名**:

```java
public Either<Code, List<Map<String, Object>>> restBatchSave(
    BeanType<?> desc,
    List<Map<String, Object>> body,
    Model model
)
```

**使用场景**: 批量数据导入,混合创建和更新操作

### 5.3 restPatch() - 只更新(不创建)

**方法签名**:

```java
public Either<Code, Map<String, Object>> restPatch(
    BeanType<?> desc,
    Map<String, Object> body,
    Model model
)
```

**工作逻辑**:

- 如果实体存在 → 更新
- 如果实体不存在 → 返回错误

### 5.4 restBatchPatch() - 批量只更新

**方法签名**:

```java
public Either<Code, List<Map<String, Object>>> restBatchPatch(
    BeanType<?> desc,
    List<Map<String, Object>> body,
    Model model
)
```

**使用场景**: 批量更新操作,不允许创建新实体

## 六、数据权限

### 6.1 获取数据权限表达式

```java
Expression dataPermission = model.getDataPermissionWhere(
    authenticationService.filter(desc)
);
```

**作用**:

- 根据当前用户的权限生成查询条件
- 系统自动根据 `owner` 字段过滤数据
- 确保用户只能访问自己有权限的数据

### 6.2 数据权限应用场景

**查询操作**:

```java
// 用户只能查看自己负责的数据
dataService.fetchDetail(desc, id, model, dataPermission);
dataService.queryMap(desc, model, dataPermission, queryPredicate, page);
```

**更新操作**:

````java
// 用户只能修改自己负责的数据
dataService.patch(desc, id, body, model, dataPermission);
## 六、数据权限

### 6.1 数据权限参数

**Expression dataPermission 参数**:
- 类型: `io.ebean.Expression`
- 作用: 限制用户只能访问有权限的数据
- 来源: 由调用方根据用户权限构建

### 6.2 数据权限应用

**查询操作**:
```java
dataService.fetchDetail(desc, id, model, dataPermission);
dataService.queryMap(desc, model, dataPermission, queryPredicate, page);
````

**更新操作**:

```java
dataService.patch(desc, id, body, model, dataPermission);
```

**删除操作**:

```java
dataService.delete(desc, id, model, dataPermission);
```

### 6.3 内部实现

- 将 dataPermission 表达式添加到查询条件中
- 确保只能操作满足权限条件的数据
- 如果数据不满足权限条件,返回 `Code.NOT_FOUND`
  Model model = modelE.get();

```

### 7.2 Model 内容

Model 包含以下信息:

**字段定义** (`form` 或 `view` 或 `table`):
## 七、Model 参数详解

### 7.1 Model 参数

**类型**: `com.gitssie.openapi.models.Model`

**作用**:
- 提供字段定义和验证规则
- 控制返回哪些字段
- 定义字段的验证逻辑

### 7.2 Model 内部使用

**验证**:
- DataService 使用 Model 验证输入数据
- 检查字段类型、必填、长度等规则

**字段过滤**:
- 根据 Model 配置选择返回哪些字段
- 支持嵌套对象的字段过滤

**权限控制**:
- 提供字段级权限配置
- 控制用户可以访问的字段n dataService.batchPatch(desc, body, model);
}

// ❌ 错误: 使用自动注入(会注入错误的类型)
@PatchMapping("/api/data/object/regional/members/batch")
@Call(apiKey = "regional", funcName = "BatchMembersEdit")
public Either<Code, List<Map<String, Object>>> batchPatch(
        BeanType<EntityBean> desc,  // ❌ 这会注入 Regional 而非 RegionalMembers
        Model model,
        @RequestBody List<Map<String, Object>> body) {

    return dataService.batchPatch(desc, body, model);
}
```

**原因**:

- `apiKey` 用于获取 JavaScript 配置文件
- 框架自动注入的 `BeanType` 根据 `apiKey` 解析
- 如果 apiKey 与实体不一致,会注入错误的类型

## 九、返回值规范

### 9.1 单个操作返回值

**成功**:

```java
Either.right(Map.of("id", 123))
```

**失败**:

````java
## 八、BeanType 参数详解

### 8.1 BeanType 参数

**类型**: `io.ebean.BeanType<T>`

**作用**:
- 描述实体类型的元数据
- 提供实体属性、关联关系等信息
- 用于数据库操作

### 8.2 获取方式

```java
BeanType<Regional> desc = ebeanApi.desc(Regional.class);
````

### 8.3 使用注意事项

- BeanType 必须与实际操作的实体类型匹配
- 通过 `ebeanApi.desc()` 方法获取
- 泛型参数指定实体类型 rrors(Option.of(errors)) // 附加验证错误
  Code.FAILED_PRECONDITION.withMessage("自定义错误消息")

````

## 十一、事务管理

### 11.1 自动事务

所有写操作方法自动添加 `@Transactional` 注解:
- `create`、`batchSave`
- `patch`、`batchPatch`
- `delete`、`batchDelete`
- `restSave`、`restBatchSave`

### 11.2 只读事务

所有查询方法自动添加 `@Transactional(readOnly = true)`:
- `fetchDetail`、`fetchDetailList`
- `queryMap`、`queryMapSlice`
- `queryCount`

### 11.3 事务回滚

当返回 `Either.left` 时,框架自动调用 `ebeanApi.setRollbackOnly()` 回滚事务。

## 十二、最佳实践

### 12.1 优先使用 DataService

```java
// ✅ 推荐: 使用 DataService
return dataService.patch(desc, id, body, model, dataPermission);

// ❌ 不推荐: 直接使用 EbeanApi
T bean = ebeanApi.find(desc.type(), id);
ebeanApi.copyMap(bean, body);
ebeanApi.save(bean);
````

**原因**:

- DataService 提供参数验证
- 自动应用数据权限
- 统一的错误处理
- 事务自动管理

### 12.2 批量操作优于循环调用

```java
// ✅ 正确: 使用批量方法
return dataService.batchPatch(desc, batchData, model);

// ❌ 错误: 循环调用单个方法
for (Map<String, Object> data : batchData) {
    dataService.patch(desc, data.get("id"), data, model);
}
```

**原因**:

- 单个事务执行
- 性能更高
- 部分失败不影响其他操作

### 12.3 返回 Map<String, Object>

```java
// ✅ 正确: 返回 Map
public Either<Code, Map<String, Object>> patch(...) {
    return dataService.patch(desc, id, body, model);
}

// ❌ 错误: 返回实体类
public Either<Code, Regional> patch(...) {
    Regional bean = ...;
    return Either.right(bean);
}
```

**原因**: 支持 JavaScript 字段过滤和格式化

### 12.4 必须应用数据权限

```java
// ✅ 正确: 应用数据权限
Expression dataPermission = model.getDataPermissionWhere(
    authenticationService.filter(desc)
);
return dataService.patch(desc, id, body, model, dataPermission);

// ❌ 错误: 忽略数据权限
return dataService.patch(desc, id, body, model);
```

### 12.5 Model 自动注入 vs 手动获取

````java
// ✅ 推荐: 使用 Web 注解自动注入
@PatchMapping("/api/data/object/{apiKey}/{id}")
## 十二、最佳实践

### 12.1 优先使用 DataService

```java
// ✅ 推荐: 使用 DataService
return dataService.patch(desc, id, body, model, dataPermission);

// ❌ 不推荐: 直接使用 EbeanApi
T bean = ebeanApi.find(desc.type(), id);
ebeanApi.copyMap(bean, body);
ebeanApi.save(bean);
````

**原因**:

- DataService 提供参数验证
- 自动应用数据权限
- 统一的错误处理
- 事务自动管理

### 12.2 批量操作优于循环调用

```java
// ✅ 正确: 使用批量方法
return dataService.batchPatch(desc, batchData, model);

// ❌ 错误: 循环调用单个方法
for (Map<String, Object> data : batchData) {
    dataService.patch(desc, data.get("id"), data, model);
}
```

**原因**:

- 单个事务执行
- 性能更高
- 部分失败不影响其他操作

### 12.3 返回 Map<String, Object>

```java
// ✅ 正确: 返回 Map
public Either<Code, Map<String, Object>> patch(...) {
    return dataService.patch(desc, id, body, model);
}

// ❌ 错误: 返回实体类
public Either<Code, Regional> patch(...) {
    Regional bean = ...;
    return Either.right(bean);
}
```

**原因**: DataService 已经返回 Map 类型,支持字段过滤

## 一、创建操作

### 1.1 单个创建 - create()

**方法签名**:

```java
public <T> Either<Code, Map<String, Object>> create(
    BeanType<T> desc,
    Map<String, Object> body,
    Model model
)
```

**使用场景**: 创建单个新实体

**Controller 示例**:

````java
@PutMapping("/api/data/object/{apiKey}")
@PreAuthorize("hasPermission(#apiKey, 'add')")
public Either<Code, Map<String, Object>> create(
        Authentication authentication,
        BeanType<EntityBean> desc,
        @PathVariable String apiKey,
        @RequestParam(required = false) Long pageId,
## 十四、使用示例

### 示例 1: 创建实体
```java
BeanType<Regional> desc = ebeanApi.desc(Regional.class);
Map<String, Object> body = Map.of(
    "name", "华东区",
    "code", "EAST_CHINA"
);
Either<Code, Map<String, Object>> result = dataService.create(desc, body, model);
````

### 示例 2: 批量更新实体

```java
BeanType<RegionalMembers> desc = ebeanApi.desc(RegionalMembers.class);
List<Map<String, Object>> body = List.of(
    Map.of("id", 101, "permissionLevel", 1),
    Map.of("id", 102, "permissionLevel", 2)
);
Either<Code, List<Map<String, Object>>> result = dataService.batchPatch(desc, body, model);
```

### 示例 3: 分页查询

```java
BeanType<Regional> desc = ebeanApi.desc(Regional.class);
Expression dataPermission = ...; // 权限表达式
QueryPredicate queryPredicate = ...; // 查询条件
Pageable page = PageRequest.of(0, 20); // 第1页,每页20条

Either<Code, Page<Map<String, Object>>> result = dataService.queryMap(
    desc, model, dataPermission, queryPredicate, page
);
```

### 示例 4: 删除实体

```java
BeanType<Regional> desc = ebeanApi.desc(Regional.class);
Expression dataPermission = ...; // 权限表达式
Either<Code, Map<String, Object>> result = dataService.delete(
    desc, "101", model, dataPermission
);
```

## 十五、参考资料

- **DataService 源码**: `type-crm/module/openapi/src/main/java/com/gitssie/openapi/service/DataService.java`
- **EbeanApi 文档**: 参考 EbeanApi 使用文档
- **Either 错误处理**: 参考 Vavr Either 模式文档 ers/batch")
  @Call(apiKey = "regional", funcName = "MembersCreate")
  @PreAuthorize("hasPermission('regional', 'add')")
  public Either<Code, List<Map<String, Object>>> batchCreateMembers(
  Model model,
  @RequestBody List<Map<String, Object>> body) {
  BeanType<RegionalMembers> desc = ebeanApi.desc(RegionalMembers.class);
  return dataService.batchSave(desc, body, model);
  }

**返回值示例**:

```json
[
  { "success": true, "id": 101 },
  { "success": true, "id": 102 },
  { "success": false, "message": "验证失败:成员类型不能为空" }
]
```

## 二、更新操作

### 2.1 单个更新 - patch()

**方法签名**:

```java
public <T> Either<Code, Map<String, Object>> patch(
    BeanType<?> desc,
    Object id,
    Map<String, Object> body,
    Model model,
    Expression dataPermission
)
```

**使用场景**: 根据 ID 更新单个实体

**Controller 示例**:

```java
@PatchMapping("/api/data/object/{apiKey}/{id}")
@PreAuthorize("hasPermission(#apiKey, 'edit')")
public Either<Code, Map<String, Object>> patch(
        Authentication authentication,
        BeanType<EntityBean> desc,
        @PathVariable String apiKey,
        @PathVariable String id,
        @RequestParam(required = false) Long pageId,
        @RequestBody JSONObject body) {

    Either<Code, Model> modelE = metadataService.getEdit(authentication, apiKey, "Edit", pageId);
    if (modelE.isLeft()) {
        return (Either) modelE;
    }
    Model model = modelE.get();

    Expression dataPermission = model.getDataPermissionWhere(authenticationService.filter(desc));
    return dataService.patch(desc, id, body, model, dataPermission);
}
```

**关键点**:

- `id`: 实体主键
- `dataPermission`: 数据权限表达式,确保用户只能修改自己有权限的数据
- Model 只包含可编辑字段(在 `form` 中定义)

### 2.2 批量更新 - batchPatch() ⭐

**方法签名**:

```java
public Either<Code, List<Map<String, Object>>> batchPatch(
    BeanType<?> desc,
    List<Map<String, Object>> body,
    Model model
)
```

**使用场景**: 批量更新多个实体(如批量设置权限、批量修改状态)

**Controller 示例**:

```java
/**
 * 批量编辑区域成员权限
 * ⚠️ 注意: apiKey = "regional" 但实际操作 RegionalMembers 实体
 */
@PatchMapping("/api/data/object/regional/members/batch")
@Call(apiKey = "regional", funcName = "BatchMembersEdit")
@PreAuthorize("hasPermission('regional', 'edit')")
public Either<Code, List<Map<String, Object>>> batchPatchMembers(
        Model model,
        @RequestBody List<Map<String, Object>> body) {

    // 手动获取 BeanType(因为 apiKey 与实体不一致)
    BeanType<RegionalMembers> desc = ebeanApi.desc(RegionalMembers.class);
    return dataService.batchPatch(desc, body, model);
}
```

**返回值示例**:

```json
[
  { "success": true, "id": 101 },
  { "success": true, "id": 102 },
  { "success": false, "message": "数据被锁定,无法修改", "id": 103 }
]
```

**关键点**:

- 每个对象必须包含 `id` 字段(标识要更新的实体)
- 只更新 `form` 中定义的字段
- 部分失败不影响其他成功的更新

## 三、删除操作

### 3.1 单个删除 - delete()

**方法签名**:

```java
public <T> Either<Code, Map<String, Object>> delete(
    BeanType<T> desc,
    Object id,
    Model model,
    Expression dataPermission
)
```

**使用场景**: 根据 ID 删除单个实体

**Controller 示例**:

```java
@DeleteMapping("/api/data/object/{apiKey}/{id}")
@PreAuthorize("hasPermission(#apiKey, 'delete')")
public Either<Code, Map<String, Object>> delete(
        Authentication authentication,
        BeanType<EntityBean> desc,
        @PathVariable String apiKey,
        @PathVariable String id,
        @RequestParam(required = false) Long pageId) {

    Model model = new Model(apiKey);
    Either<Code, Model> modelE = metadataService.getForm(authentication, apiKey, "Delete", pageId);
    if (modelE.isRight()) {
        model = modelE.get();
    }

    Expression dataPermission = model.getDataPermissionWhere(authenticationService.filter(desc));
    return dataService.delete(desc, id, model, dataPermission);
}
```

**删除规则**:

- 如果实体 `lockStatus = true`,无法删除,返回错误
- 支持软删除(修改状态)或硬删除(物理删除)

### 3.2 批量删除 - batchDelete()

**方法签名**:

```java
public <T> Either<Code, List<Map<String, Object>>> batchDelete(
    BeanType<T> desc,
    List<String> idList,
    Model model,
    Expression dataPermission
)
```

**使用场景**: 批量删除多个实体

**Controller 示例**:

```java
@DeleteMapping("/api/data/object/regional/members/batch")
@Delete(apiKey = "regional", funcName = "MembersDelete")
@PreAuthorize("hasPermission('regional', 'delete')")
public Either<Code, List<Map<String, Object>>> batchDeleteMembers(
        Authentication authentication,
        Model model,
        @RequestBody List<String> body) {

    BeanType<RegionalMembers> desc = ebeanApi.desc(RegionalMembers.class);
    Expression dataPermission = model.getDataPermissionWhere(authenticationService.filter(desc));

    return dataService.batchDelete(desc, body, model, dataPermission);
}
```

**返回值示例**:

```json
[
  { "success": true, "id": 101 },
  { "success": false, "message": "数据被锁定,无法删除", "id": 102 }
]
```

## 四、查询操作

### 4.1 单个查询 - fetchDetail()

**方法签名**:

```java
public <T> Either<Code, Map<String, Object>> fetchDetail(
    BeanType<T> desc,
    Object id,
    Model model,
    Expression dataPermission
)
```

**使用场景**: 根据 ID 查询单个实体详情

**Controller 示例**:

```java
@GetMapping("/api/data/object/{apiKey}/{id}")
@PreAuthorize("hasPermission(#apiKey, 'view')")
public Either<Code, Map<String, Object>> getDetail(
        Authentication authentication,
        BeanType<EntityBean> desc,
        @PathVariable String apiKey,
        @PathVariable String id,
        @RequestParam(required = false) Long pageId) {

    Either<Code, Model> modelE = metadataService.getView(authentication, apiKey, "View", pageId);
    if (modelE.isLeft()) {
        return (Either) modelE;
    }
    Model model = modelE.get();

    Expression dataPermission = model.getDataPermissionWhere(authenticationService.filter(desc));
    return dataService.fetchDetail(desc, id, model, dataPermission);
}
```

**返回值示例**:

```json
{
  "id": 123,
  "name": "华东区",
  "code": "EAST_CHINA",
  "parentRegional": {
    "id": 100,
    "name": "中国大陆"
  },
  "enabled": true,
  "createdAt": "2025-01-15T10:30:00"
}
```

### 4.2 批量查询 - fetchDetailList()

**方法签名**:

```java
public <T> Either<Code, List<Map<String, Object>>> fetchDetailList(
    BeanType<T> desc,
    List<Long> ids,
    Model model,
    Expression dataPermission
)
```

**使用场景**: 根据 ID 列表批量查询实体详情

**Controller 示例**:

```java
@PostMapping("/api/data/batch/view/{apiKey}")
@PreAuthorize("hasPermission(#apiKey, 'view')")
public Either<Code, List<Map<String, Object>>> batchDetail(
        Authentication authentication,
        BeanType<EntityBean> desc,
        @PathVariable String apiKey,
        @RequestBody List<Long> ids,
        @RequestParam(required = false) Long pageId) {

    Either<Code, Model> modelE = metadataService.getView(authentication, apiKey, "View", pageId);
    if (modelE.isLeft()) {
        return (Either) modelE;
    }
    Model model = modelE.get();

    Expression dataPermission = model.getDataPermissionWhere(authenticationService.filter(desc));
    return dataService.fetchDetailList(desc, ids, model, dataPermission);
}
```

### 4.3 分页查询 - queryMap()

**方法签名**:

```java
public <T> Either<Code, Page<Map<String, Object>>> queryMap(
    BeanType<T> desc,
    Model model,
    Expression dataPermission,
    QueryPredicate queryPredicate,
    Pageable page
)
```

**使用场景**: 分页查询实体列表

**Controller 示例**:

```java
@PostMapping("/api/data/object/{apiKey}")
@PreAuthorize("hasPermission(#apiKey, 'list')")
public Either<Code, Page<Map<String, Object>>> query(
        Authentication authentication,
        @PathVariable String apiKey,
        BeanType<EntityBean> desc,
        @RequestParam(required = false) Long pageId,
        @Validated QueryForm queryForm) {

    Either<Code, Model> modelE = metadataService.getTable(authentication, apiKey, "List", pageId);
    if (modelE.isLeft()) {
        return (Either) modelE;
    }
    Model model = modelE.get();

    Expression dataPermission = model.getDataPermissionWhere(authenticationService.filter(desc));
    return dataService.queryMap(desc, model, dataPermission, queryForm.getQuery(), queryForm.getPageable());
}
```

### 4.4 查询总数 - queryCount()

**方法签名**:

```java
public <T> Either<Code, Integer> queryCount(
    BeanType<T> desc,
    Model model,
    Expression dataPermission,
    QueryPredicate queryPredicate
)
```

**使用场景**: 获取符合条件的记录总数

## 五、Upsert 操作

### 5.1 单个 Upsert - restSave()

**方法签名**:

```java
public Either<Code, Map<String, Object>> restSave(
    BeanType<?> desc,
    Map<String, Object> body,
    Model model
)
```

**使用场景**: 存在则更新,不存在则创建(根据 ID 判断)

**Controller 示例**:

```java
@PostMapping("/api/data/upsert/{apiKey}")
@PreAuthorize("hasPermission(#apiKey, 'edit')")
public Either<Code, Map<String, Object>> upsert(
        BeanType<EntityBean> desc,
        @PathVariable String apiKey,
        Model model,
        @RequestBody JSONObject body) {

    return dataService.restSave(desc, body, model);
}
```

**请求示例**:

```json
{
  "id": 123,  // 存在 ID -> 更新
  "name": "新名称"
}

{
  // 无 ID -> 创建
  "name": "新区域",
  "code": "NEW_REGION"
}
```

### 5.2 批量 Upsert - restBatchSave()

**方法签名**:

```java
public Either<Code, List<Map<String, Object>>> restBatchSave(
    BeanType<?> desc,
    List<Map<String, Object>> body,
    Model model
)
```

**使用场景**: 批量 Upsert,混合创建和更新

## 六、数据权限

### 6.1 获取数据权限表达式

```java
Expression dataPermission = model.getDataPermissionWhere(authenticationService.filter(desc));
```

### 6.2 数据权限作用

- **行级权限控制**: 用户只能访问自己有权限的数据
- **自动过滤**: 查询、更新、删除操作自动应用权限过滤
- **owner 字段**: 系统自动根据 `owner` 字段进行权限判断

**示例**:

```java
// 用户 A 只能查看自己负责的客户
Expression dataPermission = model.getDataPermissionWhere(authenticationService.filter(desc));
// 生成: where owner_id = 当前用户ID
```

## 七、最佳实践

### 7.1 apiKey 与实体类型不一致的处理

当 `@Call` 注解的 `apiKey` 与实际操作的实体不一致时,**必须手动获取 BeanType**:

```java
// ✅ 正确: 手动获取 BeanType
@PatchMapping("/api/data/object/regional/members/batch")
@Call(apiKey = "regional", funcName = "BatchMembersEdit")
public Either<Code, List<Map<String, Object>>> batchPatchMembers(
        Model model,
        @RequestBody List<Map<String, Object>> body) {

    // apiKey = "regional",但实际操作 RegionalMembers
    BeanType<RegionalMembers> desc = ebeanApi.desc(RegionalMembers.class);
    return dataService.batchPatch(desc, body, model);
}

// ❌ 错误: 使用自动注入的 BeanType(会注入错误的类型)
@PatchMapping("/api/data/object/regional/members/batch")
@Call(apiKey = "regional", funcName = "BatchMembersEdit")
public Either<Code, List<Map<String, Object>>> batchPatchMembers(
        BeanType<EntityBean> desc,  // ❌ 这会注入 Regional 而非 RegionalMembers
        Model model,
        @RequestBody List<Map<String, Object>> body) {

    return dataService.batchPatch(desc, body, model);
}
```

**原因**:

- `apiKey = "regional"` 用于获取 JavaScript 配置(`regional.js` 中的 `BatchMembersEdit()` 函数)
- 但实际操作的数据库表对应 `RegionalMembers` 实体
- Spring 自动注入的 `BeanType` 根据 `apiKey` 解析,会注入错误的类型

### 7.2 批量操作优于循环调用

```java
// ✅ 正确: 使用批量方法
return dataService.batchPatch(desc, batchData, model);

// ❌ 错误: 循环调用单个方法
for (Map<String, Object> data : batchData) {
    dataService.patch(desc, data.get("id"), data, model);
}
```

**原因**:

- 批量方法在单个事务中执行,性能更高
- 部分失败不影响其他成功的操作
- 减少数据库连接开销

### 7.3 返回类型规范

```java
// ✅ 正确: 返回 Map<String, Object>
public Either<Code, Map<String, Object>> patch(...) {
    return dataService.patch(desc, id, body, model);
}

// ❌ 错误: 返回实体类
public Either<Code, Regional> patch(...) {
    Regional bean = ...;
    return Either.right(bean);
}
```

**原因**: 返回 Map 类型才能支持 JavaScript 字段过滤和格式化

### 7.4 数据权限必须应用

```java
// ✅ 正确: 应用数据权限
Expression dataPermission = model.getDataPermissionWhere(authenticationService.filter(desc));
return dataService.patch(desc, id, body, model, dataPermission);

// ❌ 错误: 忽略数据权限
return dataService.patch(desc, id, body, model); // 缺少 dataPermission
```

### 7.5 Model 自动注入 vs 手动获取

```java
// ✅ 推荐: 使用 Web 注解自动注入
@PatchMapping("/api/data/object/{apiKey}/{id}")
@Edit(apiKey = "regional")
public Either<Code, Map<String, Object>> patch(
        BeanType<Regional> desc,
        Model model,  // ✅ 自动注入
        @PathVariable Long id,
        @RequestBody JSONObject body) {

    return dataService.patch(desc, String.valueOf(id), body, model);
}

// ❌ 不推荐: 手动获取(代码冗余)
@PatchMapping("/api/data/object/{apiKey}/{id}")
public Either<Code, Map<String, Object>> patch(...) {
    Either<Code, Model> modelE = metadataService.getEdit(authentication, apiKey, "Edit", pageId);
    if (modelE.isLeft()) {
        return (Either) modelE;
    }
    Model model = modelE.get();
    // ...
}
```

## 八、常见错误处理

### 8.1 NOT_FOUND(数据不存在)

```java
return Either.left(Code.NOT_FOUND);
```

**场景**: 根据 ID 查询或更新数据,但数据不存在

### 8.2 INVALID_ARGUMENT(参数验证失败)

```java
return Either.left(Code.INVALID_ARGUMENT.withErrors(Option.of(errors)));
```

**场景**: JavaScript 配置中的 `rule` 验证失败

### 8.3 FAILED_PRECONDITION(前置条件失败)

```java
return Either.left(Code.FAILED_PRECONDITION.withMessage("数据被锁定,无法删除"));
```

**场景**:

- 数据被锁定(`lockStatus = true`)
- 业务规则不允许操作

### 8.4 PERMISSION_DENIED(权限不足)

```java
@PreAuthorize("hasPermission(#apiKey, 'edit')")
```
