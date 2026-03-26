# Ebean Query 项目实战指南

## 核心 API 快速参考

### QueryForm 前端查询参数

**QueryForm 结构：**

```java
public class QueryForm extends AbstractQuery {
    private QueryPredicate query;  // 查询条件
    private int page;              // 页码（0-based）
    private int size;              // 每页数量
    private String orderBy;        // 排序字段

    // 获取 Spring Pageable（已转换为0-based）
    public Pageable getPageable();

    // 获取查询条件
    public QueryPredicate getQuery();
}
```

**项目规范：Controller 接收 QueryForm**

```java
@PostMapping("/api/data/object/regional")
@Query(apiKey = "regional")
public Either<Code, Page<Map<String, Object>>> query(
        Model model,
        @Validated @RequestBody QueryForm queryForm) {  // 统一接收 QueryForm

    BeanType<Regional> desc = ebeanApi.desc(Regional.class);

    // 1. 使用 ebeanApi.parsePredicate 解析查询条件（推荐）
    Either<Code, Expression> whereE = ebeanApi.parsePredicate(desc, queryForm);
    if (whereE.isLeft()) {
        return (Either) whereE;
    }

    // 2. 使用 queryForm.getPageable() 获取分页参数（已转换为0-based）
    Pageable pageable = queryForm.getPageable();

    // 3. 执行查询
    return dataService.queryMap(desc, model, whereE.get(), pageable);
}
```

**前端查询参数示例：**

```json
{
  "page": 0,
  "size": 20,
  "orderBy": "createdAt desc",
  "query": {
    "predicate": [
      { "field": "status", "op": "eq", "value": 1 },
      { "field": "name", "op": "contains", "value": "张三" }
    ]
  }
}
```

### ebeanApi.parsePredicate() 解析查询条件

```java
// 解析前端传来的查询条件
Either<Code, Expression> whereE = ebeanApi.parsePredicate(
    ebeanApi.desc(RegionalMembers.class),  // BeanType
    queryForm                               // QueryForm
);

if (whereE.isLeft()) {
    // 解析失败，返回错误码
    return (Either) whereE;
}

// 添加到查询
query.where().add(whereE.get());
```

**支持的查询操作符：**
| 前端 op | SQL | 说明 |
|---------|-----|------|
| `eq` | `=` | 等于 |
| `ne` | `<>` | 不等于 |
| `gt` | `>` | 大于 |
| `ge` | `>=` | 大于等于 |
| `lt` | `<` | 小于 |
| `le` | `<=` | 小于等于 |
| `contains` | `LIKE %value%` | 包含 |
| `startsWith` | `LIKE value%` | 开头匹配 |
| `endsWith` | `LIKE %value` | 结尾匹配 |
| `in` | `IN` | 在列表中 |
| `isNull` | `IS NULL` | 为空 |
| `isNotNull` | `IS NOT NULL` | 不为空 |

### ebeanApi 与 database 的区别

```java
// ebeanApi - 项目封装的统一API（推荐）
Query<Customer> query = ebeanApi.createQuery(Customer.class);
Query<Customer> query = ebeanApi.find(Customer.class);

// database - Ebean原生API（特殊场景）
Query<Customer> query = database.createQuery(Customer.class);
Query<Customer> query = database.find(Customer.class);
```

**规则：** 优先使用 `ebeanApi`，它提供了额外的实体缓存和类型转换支持。

### 分页索引规则

**关键：Ebean 使用 0-based index**

```java
// ✅ 正确：第1页 pageNumber = 0
query.setPaging(Paging.of(0, 10));

// ❌ 错误：第1页 pageNumber = 1（实际查询第2页）
query.setPaging(Paging.of(1, 10));

// 前端转换（Spring Pageable 是 0-based）
Pageable pageable = queryForm.getPageable();  // pageNumber 已经是 0-based
query.setPaging(Paging.of(pageable.getPageNumber(), pageable.getPageSize()));
```

## 项目特有模式

### 1. 标准 Controller 查询模式

**场景：** 接收前端查询参数，执行标准查询

```java
@PostMapping("/api/data/object/regional")
@Query(apiKey = "regional")
public Either<Code, Page<Map<String, Object>>> query(
        Model model,
        @Validated @RequestBody QueryForm queryForm) {

    BeanType<Regional> desc = ebeanApi.desc(Regional.class);

    // 直接使用 dataService.queryMap（推荐）
    return dataService.queryMap(
        desc,
        model,
        queryForm.getQuery(),    // 查询条件
        queryForm.getPageable()  // 分页参数（0-based）
    );
}
```

**优势：** dataService 自动处理 parsePredicate、分页、排序、JS 配置转换。

### 2. 自定义查询条件模式

**场景：** 需要自定义查询条件时

```java
@PostMapping("/api/data/object/regional/members")
@Query(apiKey = "regional", funcName = "MembersList")
public Either<Code, Page<Map<String, Object>>> queryMembers(
        Model model,
        @Validated @RequestBody QueryForm queryForm) {

    BeanType<RegionalMembers> desc = ebeanApi.desc(RegionalMembers.class);

    // 1. 解析前端查询条件
    Either<Code, Expression> whereE = ebeanApi.parsePredicate(desc, queryForm);
    if (whereE.isLeft()) {
        return (Either) whereE;
    }

    // 2. 添加自定义条件
    Expression where = whereE.get();
    where = ebeanApi.expr().and(
        where,
        ebeanApi.expr().eq("status", 1)  // 只查询状态为1的
    );

    // 3. 执行查询
    return dataService.queryMap(desc, model, where, queryForm.getPageable());
}
```

### 3. 去重分页查询（关联表查询主表）

**场景：** 从 RegionalMembers 查询去重的 User 列表

```java
// 1. 数据库层面去重+分页（关键）
var query = ebeanApi.createQuery(RegionalMembers.class)
        .select("user.id")
        .setDistinct(true)  // 数据库去重
        .setPaging(Paging.of(pageNumber, pageSize));  // 数据库分页

if (whereExpression != null) {
    query.where().add(whereExpression);
}

// 2. 获取当前页的去重ID
Set<Long> distinctUserIds = query.findSingleAttributeSet();

// 3. 批量查询主表数据
List<User> users = ebeanApi.list(User.class, ebeanApi.expr().idIn(distinctUserIds));

// 4. 使用 JS 函数配置转换
boolean readEnd = distinctUserIds.size() < pageSize;
Slice<Map<String, Object>> page = ebeanApi.toJSON(
    model,  // JS 函数配置
    ebeanApi.desc(User.class),  // 主表 BeanType
    new SliceImpl<>(users, pageable, readEnd)
);
```

**优势：**

- 去重和分页在数据库层面完成
- 只查询当前页需要的 ID（内存占用小）
- 返回主表数据而不是关联表数据

### 2. 批量验证是否存在（避免 N+1）

**场景：** 批量添加成员前验证重复

```java
// ❌ 错误：循环查询（100个用户 = 100次查询）
for (Long userId : userIds) {
    boolean exists = ebeanApi.find(RegionalMembers.class)
        .where()
        .eq("regional.id", regionalId)
        .eq("user.id", userId)
        .findCount() > 0;
}

// ✅ 正确：批量查询（100个用户 = 1次查询）
Set<Long> existingUserIds = ebeanApi.findSingleAttributeSet(
    RegionalMembers.class,
    "user.id",
    ebeanApi.where()
        .eq("regional.id", regionalId)
        .in("user.id", userIds)
);

// 过滤新用户
List<Long> newUserIds = userIds.stream()
    .filter(id -> !existingUserIds.contains(id))
    .collect(Collectors.toList());
```

### 3. 根据 apiKey 或 name 查询 ID

**场景：** EntityService 中的实体查询

```java
// 根据 ID 查询 name
String name = ebeanApi.createQuery(EntityMapping.class)
    .select("name")
    .where().idEq(apiKey)
    .findSingleAttribute();

// 根据 name 查询 ID
Long id = ebeanApi.createQuery(EntityMapping.class)
    .select("id")
    .where().eq("name", apiKey)
    .findSingleAttribute();
```

### 4. 批量查询转 Map（code 或 ID 为 key）

**场景：** EbeanProvider 中的批量查询

```java
// 根据 ID 批量查询
Map<Long, T> map = database.createQuery(beanClass)
    .where()
    .idIn(idList)
    .setMaxRows(idList.size())
    .findMap();  // 默认以 ID 为 key

// 根据 code 批量查询
Map<String, T> map = database.createQuery(beanClass)
    .where()
    .in("code", codes)
    .setMapKey("code")  // 指定 key 字段
    .setMaxRows(codes.size())
    .findMap();
```

### 5. 查询去重字段列表

**场景：** EntityService 查询所有模块名称

```java
// 查询去重的模块列表
List<String> modules = ebeanApi.find(EntityMapping.class)
    .select("module")
    .where().isNotNull("module")
    .setDistinct(true)  // 数据库去重
    .findSingleAttributeList();
```

### 6. 关联查询路径规则

```java
// ✅ 正确：使用点号表示关联
query.where().eq("user.id", 1L);
query.where().eq("customer.department.name", "销售部");
query.select("user.id");
query.orderBy("customer.name asc");

// ❌ 错误：使用下划线
query.where().eq("user_id", 1L);  // 不是关联查询，是字段名
```

## 性能优化规则

### 1. 单个对象查询必须加 setMaxRows(1)

```java
// ✅ 推荐
Customer customer = ebeanApi.find(Customer.class)
    .where().eq("code", "C001")
    .setMaxRows(1)  // 数据库只查1条
    .findOne();

// ❌ 不推荐
Customer customer = ebeanApi.find(Customer.class)
    .where().eq("code", "C001")
    .findOne();  // 数据库可能扫描多行
```

### 2. 使用 select() 减少字段查询

```java
// ✅ 只查需要的字段
query.select("id, name, email");

// ❌ 查询所有字段（默认行为）
query.findList();
```

### 3. 批量查询使用 findSingleAttributeSet()

```java
// ✅ 性能最优：1次数据库查询 + Set自动去重
Set<Long> ids = ebeanApi.findSingleAttributeSet(
    RegionalMembers.class,
    "user.id",
    whereExpression
);

// ❌ 性能差：先查实体再提取ID
List<RegionalMembers> members = ebeanApi.find(RegionalMembers.class)
    .where().add(whereExpression)
    .findList();
Set<Long> ids = members.stream()
    .map(m -> m.getUser().getId())
    .collect(Collectors.toSet());
```

### 4. 关联查询使用 fetch() 预加载

```java
// ✅ 预加载关联（1+1次查询：主表+关联表）
List<Customer> customers = ebeanApi.find(Customer.class)
    .fetch("orders")
    .findList();

// ❌ 懒加载（1+N次查询：主表+每个customer的orders）
List<Customer> customers = ebeanApi.find(Customer.class).findList();
for (Customer c : customers) {
    c.getOrders();  // 每次触发一次查询
}
```

## 常见错误

### 1. 分页索引使用 1-based

```java
// ❌ 错误：前端第1页传1，导致查询第2页
int frontendPage = 1;  // 前端传过来的页码
query.setPaging(Paging.of(frontendPage, 10));  // 实际查第2页

// ✅ 正确：Spring Pageable 已经是 0-based
Pageable pageable = queryForm.getPageable();
query.setPaging(Paging.of(pageable.getPageNumber(), pageable.getPageSize()));
```

### 2. 忘记 setMaxRows 导致全表扫描

```java
// ❌ 危险：可能返回大量数据
List<Customer> customers = ebeanApi.find(Customer.class)
    .where().eq("status", 1)
    .findList();  // 可能返回数万条

// ✅ 安全：限制最大返回数
List<Customer> customers = ebeanApi.find(Customer.class)
    .where().eq("status", 1)
    .setMaxRows(1000)  // 最多1000条
    .findList();
```

### 3. 关联查询使用字段名而不是路径

```java
// ❌ 错误：user_id 是字段名，不是关联
query.where().eq("user_id", 1L);

// ✅ 正确：user.id 是关联路径
query.where().eq("user.id", 1L);
```

## 项目约定

### 1. Controller 返回 Map 而不是实体

```java
// ✅ 正确：使用 ebeanApi.toJSON 转换
Slice<Map<String, Object>> page = ebeanApi.toJSON(
    model,  // JS 函数配置
    desc,   // BeanType
    slice   // Slice<T>
);

// ❌ 错误：直接返回实体
return Either.right(new SliceImpl<>(users, pageable, readEnd));
```

### 2. 查询条件使用 ebeanApi.parsePredicate

```java
// ✅ 推荐：解析前端传来的查询条件
Either<Code, Expression> whereE = ebeanApi.parsePredicate(desc, queryForm);
if (whereE.isLeft()) {
    return (Either) whereE;
}
query.where().add(whereE.get());

// ❌ 不推荐：手动构建条件（容易出错）
query.where()
    .eq("status", queryForm.getStatus())
    .like("name", "%" + queryForm.getName() + "%");
```

### 3. 分页查询返回 Slice 而不是 Page

```java
// ✅ 推荐：返回 Slice（不查询总数）
boolean readEnd = result.size() < pageSize;
return Either.right(new SliceImpl<>(result, pageable, readEnd));

// ❌ 不推荐：返回 Page（需要额外 COUNT 查询）
int total = query.findCount();  // 额外一次查询
return Either.right(new PageImpl<>(result, pageable, total));
```

**原因：** Slice 不需要 COUNT 查询，性能更好，适合"加载更多"场景。

## 总结

### 关键方法

| 方法                       | 用途           | 性能                   |
| -------------------------- | -------------- | ---------------------- |
| `findOne()`                | 查询单个对象   | 必须加 `setMaxRows(1)` |
| `findList()`               | 查询列表       | 考虑加 `setMaxRows()`  |
| `findSingleAttribute()`    | 查询单个字段值 | 高效                   |
| `findSingleAttributeSet()` | 批量去重查询   | **最优**               |
| `findMap()`                | 批量查询转 Map | 高效                   |

### 性能要点

1. **批量查询用 `findSingleAttributeSet()`**：避免 N+1
2. **单个查询加 `setMaxRows(1)`**：避免全表扫描
3. **去重+分页用 `setDistinct() + setPaging()`**：数据库层面处理
4. **关联查询用 `fetch()`**：避免懒加载
5. **返回 Slice 而不是 Page**：不查询总数

### 分页规则

- **Ebean Query**: 0-based index（第 1 页是 0）
- **Spring Pageable**: 0-based index（第 1 页是 0）
- **前端**: 通常 1-based（需要转换）
