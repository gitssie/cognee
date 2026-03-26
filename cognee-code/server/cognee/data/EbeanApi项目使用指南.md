# EbeanApi 项目使用指南

## 核心原则

**EbeanApi 是项目对 Ebean ORM 的封装层**，提供统一的数据访问接口。本文档专注于项目特定用法和最佳实践。

### 重要规则

1. **优先使用 DataService**：Controller 层应调用 DataService，而非直接使用 EbeanApi
2. **返回 Map 而非实体**：Controller 必须返回 `Map<String, Object>`，支持 JavaScript 字段过滤
3. **使用 Either 模式**：错误处理使用 `Either<Code, T>`，不抛异常
4. **使用 ref() 设置关联**：只需要外键关联时使用 `ref()`，避免不必要的查询

---

## 一、常用查询方法

### 1.1 单个实体查询

```java
// 根据 ID 查询
Customer customer = ebeanApi.findOne(Customer.class, 123L);

// 根据条件查询
ExpressionList<Customer> where = ebeanApi.where();
where.eq("code", "EAST_CHINA");
Customer customer = ebeanApi.findOne(Customer.class, where);
```

### 1.2 列表查询

```java
// 条件查询列表
ExpressionList<Customer> where = ebeanApi.where();
where.eq("status", 1);
List<Customer> customers = ebeanApi.list(Customer.class, where);

// 根据 ID 批量查询
List<Long> ids = Arrays.asList(1L, 2L, 3L);
List<Customer> customers = ebeanApi.listById(Customer.class, ids);
```

### 1.3 统计查询

```java
// 统计记录数
ExpressionList<Customer> where = ebeanApi.where();
where.eq("status", 1);
int count = ebeanApi.findCount(Customer.class, where);
```

### 1.4 批量查询转 Map（避免 N+1）

```java
// 根据 ID 列表批量查询，返回 Map（key 为实体 ID）
List<Long> ids = Arrays.asList(1L, 2L, 3L);
Map<Long, Customer> customerMap = ebeanApi.findMap(Customer.class, ids);

// 根据 code 列表批量查询，返回 Map（key 为 code）
List<String> codes = Arrays.asList("EAST", "WEST", "SOUTH");
Map<String, Region> regionMap = ebeanApi.findMap(Region.class, "code", codes);
```

### 1.5 高效批量去重查询 ⭐

```java
// 使用 findSingleAttributeSet 批量查询已存在成员（推荐）
Set<Long> existingUserIds = ebeanApi.findSingleAttributeSet(
    RegionalMembers.class,
    "user.id",
    (Expression) ebeanApi.where()
        .eq("regional.id", regionalId)
        .in("user.id", userIds)
);

// 过滤出需要新增的成员
List<Long> newUserIds = userIds.stream()
    .filter(id -> !existingUserIds.contains(id))
    .collect(Collectors.toList());
```

**使用场景：**

- 批量数据去重验证
- 获取关联 ID 集合
- 高效的存在性检查（避免 N+1 查询）

**性能对比：**

- ❌ N+1 查询：100 个用户 = 100 次数据库查询
- ✅ 批量查询：100 个用户 = 1 次数据库查询

---

## 二、条件构建 (ExpressionList)

### 2.1 基本比较

```java
ExpressionList<Customer> where = ebeanApi.where();

// 常用条件
where.eq("status", 1);              // 等于
where.ne("status", 0);              // 不等于
where.gt("age", 18);                // 大于
where.ge("age", 18);                // 大于等于
where.lt("age", 60);                // 小于
where.le("age", 60);                // 小于等于
where.in("status", Arrays.asList(1, 2, 3)); // IN
where.isNull("email");              // 为空
where.isNotNull("email");           // 非空
```

### 2.2 字符串匹配

```java
where.like("name", "%张%");         // LIKE
where.contains("name", "张");       // 包含
where.startsWith("name", "张");     // 以...开头
where.endsWith("name", "三");       // 以...结尾
```

### 2.3 逻辑组合

```java
// AND（默认）
where.eq("status", 1)
     .eq("type", "VIP");

// OR
where.eq("status", 1)
     .or()
     .eq("status", 2);

// 复杂组合
where.eq("status", 1)
     .or()
     .and()
     .like("name", "%test%")
     .ge("createTime", startDate);
```

---

## 三、保存与更新

### 3.1 保存实体

```java
// 创建新实体
Customer customer = new Customer();
customer.setName("张三");
customer.setStatus(1);
ebeanApi.save(customer);

// 批量保存
List<Customer> customers = Arrays.asList(customer1, customer2, customer3);
ebeanApi.saveAll(customers);
```

### 3.2 条件更新

```java
// 批量更新
ExpressionList<Customer> where = ebeanApi.where();
where.eq("status", 0);

UpdateQuery<Customer> update = ebeanApi.update(Customer.class, where);
update.set("status", 1);
int rows = update.execute();
```

### 3.3 删除

```java
// 删除单个实体
Customer customer = ebeanApi.findOne(Customer.class, 123L);
ebeanApi.delete(customer);

// 条件删除
ExpressionList<Customer> where = ebeanApi.where();
where.eq("status", 0);
int deletedCount = ebeanApi.delete(Customer.class, where);
```

---

## 四、项目特定方法

### 4.1 获取 BeanType 描述

```java
// 获取实体类型信息（用于 DataService 操作）
BeanType<Customer> desc = ebeanApi.desc(Customer.class);

// 通过 apiKey 获取实体类
Class<Customer> clazz = ebeanApi.beanClass("customer");
BeanType<Customer> desc = ebeanApi.desc("customer");
```

### 4.2 实体引用 (ref) ⭐

```java
// ✅ 推荐：只需要引用时使用 ref()（不触发数据库查询）
Customer customerRef = ebeanApi.ref(Customer.class, 123L);
order.setCustomer(customerRef); // 只设置外键，不查询完整数据

// ❌ 不推荐：完整查询后只用于关联
Customer customer = ebeanApi.findOne(Customer.class, 123L);
order.setCustomer(customer); // 产生了不必要的查询
```

### 4.3 空值安全检查

```java
// 检查 EntityBean 引用是否为空（支持懒加载对象）
Customer customerRef = ebeanApi.ref(Customer.class, 999L);
boolean empty = ebeanApi.isEmpty(customerRef); // true

// 安全访问懒加载对象
if (!ebeanApi.isEmpty(order.getCustomer())) {
    String name = order.getCustomer().getName();
}
```

### 4.4 JSON 转换

```java
// 实体转 Map
Customer customer = ebeanApi.findOne(Customer.class, 123L);
Map<String, Object> json = ebeanApi.toJSON(customer);

// 根据 Model 配置过滤字段（用于 Controller 返回）
Map<String, Object> filtered = ebeanApi.toJSONMap(model, json);
```

---

## 五、最佳实践

### 5.1 优先使用 DataService ⭐⭐⭐

```java
// ✅ 推荐：使用 DataService
@PostMapping("/api/customers/{id}")
public Either<Code, Map<String, Object>> update(@PathVariable Long id, @RequestBody Map<String, Object> body, Model model) {
    BeanType<Customer> desc = ebeanApi.desc(Customer.class);
    return dataService.patch(desc, id, body, model);
}

// ❌ 不推荐：直接使用 EbeanApi
@PostMapping("/api/customers/{id}")
public Either<Code, Customer> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
    Customer bean = ebeanApi.findOne(Customer.class, id);
    ebeanApi.copyTo(body, bean);
    ebeanApi.save(bean);
    return Either.right(bean);
}
```

**原因：**

- DataService 提供参数验证
- 自动应用数据权限
- 统一的错误处理
- 事务自动管理

### 5.2 Controller 返回 Map

```java
// ✅ 推荐：返回 Map
public Either<Code, Map<String, Object>> query(...) {
    return dataService.fetchDetail(desc, id, model, dataPermission);
}

// ❌ 不推荐：返回实体
public Either<Code, Customer> query(...) {
    Customer bean = ebeanApi.findOne(Customer.class, id);
    return Either.right(bean);
}
```

### 5.3 批量操作优化

```java
// ✅ 推荐：使用 findSingleAttributeSet 批量查询去重
Set<Long> existingIds = ebeanApi.findSingleAttributeSet(
    RegionalMembers.class,
    "user.id",
    (Expression) ebeanApi.where()
        .eq("regional.id", regionalId)
        .in("user.id", userIds)
);

// ❌ 不推荐：N+1 查询
for (Long userId : userIds) {
    RegionalMembers existing = ebeanApi.findOne(
        RegionalMembers.class,
        ebeanApi.where()
            .eq("regional.id", regionalId)
            .eq("user.id", userId)
    );
    if (existing != null) {
        // 处理
    }
}
```

### 5.4 使用 ref() 而非 find() 获取引用

```java
// ✅ 推荐：只需要引用时使用 ref()
Customer customerRef = ebeanApi.ref(Customer.class, 123L);
order.setCustomer(customerRef); // 不会触发数据库查询

// ❌ 不推荐：完整查询后只用于关联
Customer customer = ebeanApi.findOne(Customer.class, 123L);
order.setCustomer(customer); // 产生了不必要的查询
```

### 5.5 使用链式调用

```java
// ✅ 推荐：链式调用
ExpressionList<Customer> where = ebeanApi.where()
    .eq("status", 1)
    .or()
    .like("name", "%test%");

// ❌ 不推荐：分步添加
ExpressionList<Customer> where = ebeanApi.where();
where.eq("status", 1);
where.or();
where.like("name", "%test%");
```

---

## 六、常见错误

### 错误 1：Code 构造错误

```java
// ❌ 错误：Code 没有 of() 方法
return Option.some(Code.of(40000, "错误信息"));

// ✅ 正确：使用构造函数
return Option.some(new Code("ERROR_CODE", "错误信息"));
```

### 错误 2：返回实体而非 Map

```java
// ❌ 错误：Controller 返回实体类
public Either<Code, Customer> getCustomer(Long id) {
    return Either.right(ebeanApi.findOne(Customer.class, id));
}

// ✅ 正确：返回 Map
public Either<Code, Map<String, Object>> getCustomer(Long id, Model model) {
    BeanType<Customer> desc = ebeanApi.desc(Customer.class);
    return dataService.fetchDetail(desc, id, model, dataPermission);
}
```

### 错误 3：直接使用 EbeanApi 而非 DataService

```java
// ❌ 错误：Controller 直接使用 EbeanApi
@PostMapping("/api/customers")
public Either<Code, Map<String, Object>> create(@RequestBody Map<String, Object> body) {
    Customer bean = ebeanApi.createBean(Customer.class);
    ebeanApi.copyTo(body, bean);
    ebeanApi.save(bean);
    return Either.right(ebeanApi.toJSON(bean));
}

// ✅ 正确：使用 DataService
@PostMapping("/api/customers")
public Either<Code, Map<String, Object>> create(@RequestBody Map<String, Object> body, Model model) {
    BeanType<Customer> desc = ebeanApi.desc(Customer.class);
    return dataService.create(desc, body, model);
}
```

---

## 七、实战示例

### 示例 1：复杂条件查询

```java
// 查询状态为 1 或 2，且名称包含"张"的客户
ExpressionList<Customer> where = ebeanApi.where();
where.or()
     .eq("status", 1)
     .eq("status", 2)
     .endOr()
     .contains("name", "张");

List<Customer> customers = ebeanApi.list(Customer.class, where);
```

### 示例 2：批量去重成员（推荐）

```java
// 使用 findSingleAttributeSet 高效查询已存在成员
Long regionalId = 10L;
List<Long> userIds = Arrays.asList(1L, 2L, 3L, 4L, 5L);
List<Long> deptIds = Arrays.asList(100L, 200L, 300L);

// 批量查询已存在的用户成员 ID
Set<Long> existingUserIds = ebeanApi.findSingleAttributeSet(
    RegionalMembers.class,
    "user.id",
    (Expression) ebeanApi.where()
        .eq("regional.id", regionalId)
        .in("user.id", userIds)
);

// 批量查询已存在的部门成员 ID
Set<Long> existingDeptIds = ebeanApi.findSingleAttributeSet(
    RegionalMembers.class,
    "department.id",
    (Expression) ebeanApi.where()
        .eq("regional.id", regionalId)
        .in("department.id", deptIds)
);

// 过滤出需要新增的成员
List<Long> newUserIds = userIds.stream()
    .filter(id -> !existingUserIds.contains(id))
    .collect(Collectors.toList());

List<Long> newDeptIds = deptIds.stream()
    .filter(id -> !existingDeptIds.contains(id))
    .collect(Collectors.toList());
```

### 示例 3：批量更新状态

```java
// 将所有过期记录设置为无效
ExpressionList<Order> where = ebeanApi.where();
where.lt("expireTime", new Date());

UpdateQuery<Order> update = ebeanApi.update(Order.class, where);
update.set("status", -1);
int updatedCount = update.execute();
```

### 示例 4：使用 ref() 设置关联

```java
// Service 层方法
public Either<Code, Map<String, Object>> createOrder(Map<String, Object> body, Model model) {
    BeanType<Order> desc = ebeanApi.desc(Order.class);

    // ✅ 使用 ref() 设置客户关联（不查询客户数据）
    Long customerId = (Long) body.get("customerId");
    Customer customerRef = ebeanApi.ref(Customer.class, customerId);

    Order order = ebeanApi.createBean(Order.class);
    order.setCustomer(customerRef);
    order.setAmount((BigDecimal) body.get("amount"));

    ebeanApi.save(order);

    return Either.right(ebeanApi.toJSONMap(model, ebeanApi.toJSON(order)));
}
```

---

## 八、方法速查表

| 方法                                                | 用途                             | 返回类型              |
| --------------------------------------------------- | -------------------------------- | --------------------- |
| `findOne(Class, id)`                                | 根据 ID 查询单个实体             | `T`                   |
| `findOne(Class, Expression)`                        | 根据条件查询单个实体             | `T`                   |
| `list(Class, Expression)`                           | 条件查询列表                     | `List<T>`             |
| `listById(Class, List)`                             | 根据 ID 列表批量查询             | `List<T>`             |
| `findMap(Class, List)`                              | 批量查询转 Map（key 为 ID）      | `Map<K, T>`           |
| `findMap(Class, String, List)`                      | 批量查询转 Map（key 为指定字段） | `Map<K, T>`           |
| `findSingleAttributeSet(Class, String, Expression)` | 批量查询单个属性集合（去重）     | `Set<B>`              |
| `findCount(Class, Expression)`                      | 统计记录数                       | `int`                 |
| `save(Object)`                                      | 保存单个实体                     | `void`                |
| `saveAll(Collection)`                               | 批量保存                         | `void`                |
| `update(Class, Expression)`                         | 条件更新                         | `UpdateQuery<T>`      |
| `delete(Object)`                                    | 删除单个实体                     | `boolean`             |
| `delete(Class, Expression)`                         | 条件删除                         | `int`                 |
| `ref(Class, id)`                                    | 获取实体引用（不查询数据）       | `T`                   |
| `isEmpty(Object)`                                   | 空值安全检查                     | `boolean`             |
| `desc(Class)`                                       | 获取 BeanType 描述               | `BeanType<T>`         |
| `beanClass(String)`                                 | 通过 apiKey 获取实体类           | `Class<T>`            |
| `toJSON(Object)`                                    | 实体转 Map                       | `Map<String, Object>` |
| `toJSONMap(Model, Map)`                             | 根据 Model 过滤字段              | `Map<String, Object>` |
| `where()`                                           | 创建查询条件                     | `ExpressionList<T>`   |
